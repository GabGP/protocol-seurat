import { describe, expect, it } from 'vitest';
import { BrushCuller, collectBrushes, cullBrushes, SKETCH_STRATUM, type BrushGeom } from '../lib/brush-cull';
import { makeBrushId } from '@/shared/proto/brush';

const bmp = (w: number): ImageBitmap => ({ width: w, height: w }) as unknown as ImageBitmap;

function tile(stratum: number, bx: number, by: number, delivery = stratum * 1000 + by * 100 + bx): BrushGeom {
  const size = 256 * 2 ** stratum;
  return { delivery, stratum, bx, by, x: bx * size, y: by * size, w: size, h: size, bmp: bmp(256), image: delivery, pw: 256, ph: 256 };
}

function sketch(iw: number, ih: number, px: number): BrushGeom {
  return { delivery: 1, stratum: SKETCH_STRATUM, bx: 0, by: 0, x: 0, y: 0, w: iw, h: ih, bmp: bmp(px), image: 1, pw: px, ph: px };
}

const ids = (l: BrushGeom[]): string[] => l.map((b) => `${b.stratum}:${b.bx},${b.by}`);

describe('cullBrushes', () => {
  const IW = 4096;
  const IH = 4096;
  const zoomed = 4; // 4 device px per image px: every tile is detailed

  it('drops a parent whose four children are drawn, keeps the sketch underneath', () => {
    const list = [sketch(IW, IH, 64), tile(1, 0, 0), tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1), tile(0, 1, 1)];
    expect(ids(cullBrushes(list, zoomed, IW, IH))).toEqual(['10:0,0', '0:0,0', '0:1,0', '0:0,1', '0:1,1']);
  });

  it('keeps a parent when any child is missing', () => {
    const list = [sketch(IW, IH, 64), tile(1, 0, 0), tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1)];
    expect(ids(cullBrushes(list, zoomed, IW, IH))).toContain('1:0,0');
  });

  it('counts children outside the image as covered (edge tiles)', () => {
    const list = [sketch(200, 200, 64), tile(1, 0, 0), tile(0, 0, 0)];
    expect(ids(cullBrushes(list, zoomed, 200, 200))).toEqual(['10:0,0', '0:0,0']);
  });

  it('drops coverage transitively (grandparent over drawn grandchildren)', () => {
    const kids = [0, 1, 2, 3].flatMap((y) => [0, 1, 2, 3].map((x) => tile(0, x, y)));
    const list = [sketch(IW, IH, 64), tile(2, 0, 0), tile(1, 0, 0), tile(1, 1, 0), tile(1, 0, 1), tile(1, 1, 1), ...kids];
    const out = cullBrushes(list, zoomed, IW, IH);
    expect(out.filter((b) => b.stratum > 0 && b.stratum < SKETCH_STRATUM)).toHaveLength(0);
    expect(out).toHaveLength(17);
  });

  it('zoomed out, drops finer tiles under an ancestor already at <= 1 texel per device px', () => {
    const list = [sketch(IW, IH, 64), tile(2, 0, 0), tile(1, 0, 0), tile(0, 0, 0)];
    // stratum-2 texel = 4 image px = 1 device px at 0.25
    expect(ids(cullBrushes(list, 0.25, IW, IH))).toEqual(['10:0,0', '2:0,0']);
    // closer, stratum 2 is soft again and stratum 1 (2 px texels = 0.6 device px) takes over
    expect(ids(cullBrushes(list, 0.3, IW, IH))).toEqual(['10:0,0', '2:0,0', '1:0,0']);
    // closer still, every tile adds detail
    expect(ids(cullBrushes(list, 0.6, IW, IH))).toEqual(['10:0,0', '2:0,0', '1:0,0', '0:0,0']);
  });

  it('with lod off, keeps every detail level and still culls covered parents', () => {
    const list = [sketch(IW, IH, 1024), tile(2, 0, 0), tile(0, 0, 0)];
    expect(ids(cullBrushes(list, 0.25, IW, IH, false))).toEqual(['10:0,0', '2:0,0', '0:0,0']);
    const full = [sketch(IW, IH, 64), tile(1, 0, 0), tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1), tile(0, 1, 1)];
    expect(ids(cullBrushes(full, 0.1, IW, IH, false))).not.toContain('1:0,0');
  });

  it('keeps finer tiles when the sharp-enough ancestor is not loaded', () => {
    const list = [sketch(IW, IH, 64), tile(0, 0, 0)];
    expect(ids(cullBrushes(list, 0.25, IW, IH))).toEqual(['10:0,0', '0:0,0']);
  });

  it('draws only the sketch once the sketch itself is sharp', () => {
    const list = [sketch(IW, IH, 1024), tile(2, 0, 0), tile(0, 0, 0)];
    expect(ids(cullBrushes(list, 0.25, IW, IH))).toEqual(['10:0,0']);
  });
});

describe('BrushCuller', () => {
  const list = [sketch(1024, 1024, 64), tile(1, 0, 0), tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1), tile(0, 1, 1)];

  it('returns the list untouched when disabled', () => {
    expect(new BrushCuller().cull(list, 4, 1024, 1024, false)).toBe(list);
  });

  it('memoizes per list and detail limit', () => {
    const c = new BrushCuller();
    const a = c.cull(list, 4, 1024, 1024, true);
    expect(c.cull(list, 3, 1024, 1024, true)).toBe(a); // same stratum limit
    expect(c.cull(list, 0.25, 1024, 1024, true)).not.toBe(a);
    expect(c.cull([...list], 4, 1024, 1024, true)).not.toBe(a);
  });
});

describe('collectBrushes', () => {
  it('places tiles in image space, sketch spanning the image, coarse first', () => {
    const recs = [
      { delivery: 2, brushId: makeBrushId(0, 3, 1), rgba: bmp(256) },
      { delivery: 1, brushId: makeBrushId(SKETCH_STRATUM, 0, 0), rgba: bmp(64) },
      { delivery: 3, brushId: makeBrushId(1, 0, 0), rgba: null },
    ];
    const out = collectBrushes(recs, 900, 600);
    expect(out.map((b) => [b.stratum, b.x, b.y, b.w, b.h])).toEqual([[10, 0, 0, 900, 600], [0, 768, 256, 256, 256]]);
  });

  it('draws only the newest synthesized delivery of a brush', () => {
    const [older, newer] = [bmp(256), bmp(256)];
    const recs = [
      { delivery: 4, brushId: makeBrushId(0, 1, 1), rgba: older }, // bands [0,2), its own synthesis
      { delivery: 9, brushId: makeBrushId(0, 1, 1), rgba: newer }, // bands [2,4): decodes all four
      { delivery: 12, brushId: makeBrushId(0, 1, 1), rgba: null }, // not synthesized yet
    ];
    expect(collectBrushes(recs, 900, 600).map((b) => b.bmp)).toEqual([newer]);
  });
});
