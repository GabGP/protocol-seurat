import { describe, expect, it } from 'vitest';
import { TileAtlas, type AtlasEvents, type AtlasGL } from '../tile-atlas';
import { SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';
import { gpuBytes } from '@/shared/lib/gpu-meter';

interface Log {
  storage: number;
  uploads: Array<{ layer: number; bmp: unknown }>;
  sketches: number;
  deleted: number;
}

function fakeGL(opts: { oomAfter?: number } = {}): { gl: AtlasGL; log: Log } {
  const log: Log = { storage: 0, uploads: [], sketches: 0, deleted: 0 };
  let error = 0;
  const gl = {
    TEXTURE_2D: 1, TEXTURE_2D_ARRAY: 2, RGBA8: 3, RGBA: 4, UNSIGNED_BYTE: 5, OUT_OF_MEMORY: 6, NO_ERROR: 0,
    TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, CLAMP_TO_EDGE: 9, TEXTURE_MIN_FILTER: 10, TEXTURE_MAG_FILTER: 11, LINEAR: 12,
    UNPACK_FLIP_Y_WEBGL: 13, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 14, UNPACK_COLORSPACE_CONVERSION_WEBGL: 15, NONE: 16,
    createTexture: () => ({}),
    deleteTexture: () => { log.deleted++; },
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    pixelStorei: () => undefined,
    texStorage3D: () => {
      log.storage++;
      if (opts.oomAfter !== undefined && log.storage > opts.oomAfter) error = 6;
    },
    texSubImage3D: (...a: unknown[]) => {
      const bmp = a[10] as { closed?: boolean };
      if (bmp.closed) throw new Error('InvalidStateError');
      log.uploads.push({ layer: a[4] as number, bmp });
    },
    texImage2D: () => { log.sketches++; },
    getError: () => { const e = error; error = 0; return e; },
  };
  return { gl: gl as unknown as AtlasGL, log };
}

const bmp = (w = 256): ImageBitmap => ({ width: w, height: w }) as unknown as ImageBitmap;

let images = 0;
function brush(stratum: number, b: ImageBitmap | null, bx = 0): BrushGeom {
  return { delivery: 0, stratum, bx, by: 0, x: 0, y: 0, w: 256, h: 256, bmp: b, image: ++images, pw: b?.width ?? 256, ph: b?.height ?? 256 };
}

const events = (): { uploaded: BrushGeom[]; needed: BrushGeom[]; ev: AtlasEvents } => {
  const uploaded: BrushGeom[] = [];
  const needed: BrushGeom[] = [];
  return { uploaded, needed, ev: { uploaded: (b) => uploaded.push(b), needPixels: (b) => needed.push(b) } };
};

describe('TileAtlas', () => {
  it('uploads the sketch first, then tiles, one layer each, and reports them ready', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 4);
    const sk = brush(SKETCH_STRATUM, bmp(64));
    const a = brush(1, bmp());
    const b = brush(0, bmp());
    atlas.reconcile([sk, a, b]);
    expect(atlas.upload(Infinity)).toBe(3);
    expect(log.sketches).toBe(1);
    expect(log.uploads.map((u) => u.layer)).toEqual([0, 1]);
    expect([sk, a, b].every((x) => atlas.ready(x))).toBe(true);
    expect(atlas.arrayCount).toBe(1);
  });

  it('frees the layer of a brush that left the book and reuses it', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 4);
    const a = brush(0, bmp());
    const b = brush(0, bmp(), 1);
    atlas.reconcile([a, b]);
    atlas.upload(Infinity);
    const layerOfA = atlas.slotOf(a.image)?.layer;
    atlas.reconcile([b]); // a scraped / expired / released
    expect(atlas.ready(a)).toBe(false);
    const c = brush(0, bmp(), 2);
    atlas.reconcile([b, c]);
    atlas.upload(Infinity);
    expect(atlas.slotOf(c.image)?.layer).toBe(layerOfA);
    expect(log.storage).toBe(1);
  });

  it('respects the time budget but always makes progress', () => {
    const { gl } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 8);
    atlas.reconcile([0, 1, 2, 3].map((i) => brush(0, bmp(), i)));
    let t = 0;
    const clock = (): number => (t += 3);
    expect(atlas.upload(3, clock)).toBe(1);
    expect(atlas.pending()).toBe(3);
  });

  it('grows another array when full, and reports a failed reservation as VRAM pressure', () => {
    const { gl } = fakeGL({ oomAfter: 1 });
    let failures = 0;
    const atlas = new TileAtlas(gl, () => { failures++; }, 2);
    const list = [0, 1, 2].map((i) => brush(0, bmp(), i));
    atlas.reconcile(list);
    expect(atlas.upload(Infinity)).toBe(2);
    expect(failures).toBe(1);
    expect(atlas.pending()).toBe(1); // kept for when eviction frees a layer
    atlas.reconcile(list.slice(1)); // eviction released list[0]
    expect(atlas.upload(Infinity)).toBe(1);
    expect(list.slice(1).every((x) => atlas.ready(x))).toBe(true);
  });

  it('drops queued bitmaps that left the book and survives one closed under it', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 4);
    const a = brush(0, bmp());
    const b = brush(0, bmp(), 1);
    atlas.reconcile([a, b]);
    atlas.reconcile([b]);
    (b.bmp as unknown as { closed: boolean }).closed = true;
    expect(() => atlas.upload(Infinity)).not.toThrow();
    expect(log.uploads).toHaveLength(0);
    expect(atlas.ready(b)).toBe(false);
  });

  it('replaces the sketch texture when a resynthesis lands', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 4);
    const s1 = brush(SKETCH_STRATUM, bmp(64));
    atlas.reconcile([s1]);
    atlas.upload(Infinity);
    const s2 = brush(SKETCH_STRATUM, bmp(64));
    atlas.reconcile([s2]);
    expect(atlas.ready(s2)).toBe(false);
    atlas.upload(Infinity);
    expect(atlas.ready(s2)).toBe(true);
    expect(log.deleted).toBe(1);
  });

  it('reports each uploaded tile so its owner can drop the bitmap, and keeps drawing it by identity', () => {
    const { gl } = fakeGL();
    const e = events();
    const atlas = new TileAtlas(gl, () => undefined, 4, e.ev);
    const a = brush(0, bmp());
    atlas.reconcile([a]);
    atlas.upload(Infinity);
    expect(e.uploaded).toEqual([a]);
    const released = { ...a, bmp: null }; // the sink closed it: same image, no bitmap
    atlas.reconcile([released]);
    expect(atlas.ready(released)).toBe(true);
    expect(atlas.slotOf(released.image)).toBeDefined();
    expect(e.needed).toHaveLength(0);
  });

  it('asks for the pixels of a live tile that has neither a bitmap nor a layer (a restored context)', () => {
    const { gl, log } = fakeGL();
    const e = events();
    const atlas = new TileAtlas(gl, () => undefined, 4, e.ev);
    const a = brush(0, bmp());
    atlas.reconcile([a]);
    atlas.upload(Infinity);
    atlas.forget(); // context lost, textures gone
    const released = { ...a, bmp: null };
    atlas.reconcile([released]);
    expect(atlas.ready(released)).toBe(false);
    expect(e.needed).toEqual([released]);
    const back = { ...released, bmp: bmp(), image: a.image + 1000 }; // the rebuilt bitmap landed
    atlas.reconcile([back]);
    atlas.upload(Infinity);
    expect(atlas.ready(back)).toBe(true);
    expect(log.uploads).toHaveLength(2);
  });

  it('never releases the sketch: its bitmap stays the minimap source', () => {
    const { gl } = fakeGL();
    const e = events();
    const atlas = new TileAtlas(gl, () => undefined, 4, e.ev);
    atlas.reconcile([brush(SKETCH_STRATUM, bmp(64))]);
    atlas.upload(Infinity);
    expect(e.uploaded).toHaveLength(0);
  });

  it('deletes an array whose layers are all free and grows again on demand', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 2);
    const list = [0, 1, 2].map((i) => brush(0, bmp(), i));
    atlas.reconcile(list);
    atlas.upload(Infinity);
    expect(atlas.arrayCount).toBe(2);
    atlas.reconcile(list.slice(0, 2)); // the third, alone in the second array, left the book
    expect(atlas.arrayCount).toBe(1);
    expect(log.deleted).toBe(1);
    atlas.reconcile([]);
    expect(atlas.arrayCount).toBe(0);
    const again = brush(0, bmp(), 5);
    atlas.reconcile([again]);
    atlas.upload(Infinity);
    expect(atlas.ready(again)).toBe(true);
    expect(atlas.arrayCount).toBe(1);
  });

  it('packs brushes into the lowest free layers, so a half-empty array can be given back', () => {
    const { gl, log } = fakeGL();
    const atlas = new TileAtlas(gl, () => undefined, 2);
    const list = [0, 1, 2, 3, 4, 5].map((i) => brush(0, bmp(), i));
    atlas.reconcile(list);
    atlas.upload(Infinity);
    expect(atlas.arrayCount).toBe(3);
    atlas.reconcile([list[1]!, list[3]!, list[5]!]); // one brush left in each array
    expect(atlas.arrayCount).toBe(3);
    const fresh = [10, 11].map((i) => brush(0, bmp(), i));
    atlas.reconcile([list[1]!, list[3]!, list[5]!, ...fresh]);
    atlas.upload(Infinity);
    expect(atlas.arrayCount).toBe(3);
    atlas.reconcile([list[1]!, ...fresh]); // the two in the top arrays go: they were the only ones there
    expect(atlas.arrayCount).toBe(2);
    expect(log.deleted).toBe(1);
  });

  it('forgets the textures of a lost context without a GL call and hands the VRAM count back', () => {
    const { gl, log } = fakeGL();
    const before = gpuBytes();
    const atlas = new TileAtlas(gl, () => undefined, 2);
    atlas.reconcile([brush(SKETCH_STRATUM, bmp(64)), brush(0, bmp())]);
    atlas.upload(Infinity);
    expect(gpuBytes()).toBeGreaterThan(before);
    atlas.forget();
    expect(log.deleted).toBe(0);
    expect(gpuBytes()).toBe(before);
    expect(atlas.arrayCount).toBe(0);
    expect(atlas.pending()).toBe(0);
  });
});
