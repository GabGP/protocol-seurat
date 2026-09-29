import { TILE } from '@/shared/config/constants';
import { GL_ATLAS_LAYERS } from '@/shared/config/render';
import { SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';

/** The slice of WebGL2 the atlas uses (a fake of it drives the tests). */
export type AtlasGL = Pick<WebGL2RenderingContext,
  'createTexture' | 'deleteTexture' | 'bindTexture' | 'texStorage3D' | 'texSubImage3D' | 'texImage2D'
  | 'texParameteri' | 'pixelStorei' | 'getError'
  | 'TEXTURE_2D' | 'TEXTURE_2D_ARRAY' | 'RGBA8' | 'RGBA' | 'UNSIGNED_BYTE' | 'OUT_OF_MEMORY' | 'NO_ERROR'
  | 'TEXTURE_WRAP_S' | 'TEXTURE_WRAP_T' | 'CLAMP_TO_EDGE' | 'TEXTURE_MIN_FILTER' | 'TEXTURE_MAG_FILTER' | 'LINEAR'
  | 'UNPACK_FLIP_Y_WEBGL' | 'UNPACK_PREMULTIPLY_ALPHA_WEBGL' | 'UNPACK_COLORSPACE_CONVERSION_WEBGL' | 'NONE'>;

export interface Slot {
  array: number;
  layer: number;
}

/**
 * Spec §5.1 VRAM: one RGBA8 256² layer of a TEXTURE_2D_ARRAY per owned brush, in arrays of
 * GL_ATLAS_LAYERS layers; the sketch (seed-sized) gets its own 2D texture. Layers are keyed by
 * the brush's ImageBitmap: a brush that leaves the book (RASPAR, expiry, SOLTAR) frees its layer
 * at the next reconcile, which runs before the next paint.
 */
export class TileAtlas {
  private readonly arrays: WebGLTexture[] = [];
  private readonly free: Slot[] = [];
  private readonly slots = new Map<ImageBitmap, Slot>();
  private queue: ImageBitmap[] = [];
  private sketch: { bmp: ImageBitmap; tex: WebGLTexture } | null = null;
  /** The live sketch's bitmap, known from the brush list (never guessed from its size). */
  private sketchWanted: ImageBitmap | null = null;
  /** Bumped whenever the set of drawable brushes changes (upload or free). */
  version = 0;

  constructor(
    private readonly gl: AtlasGL,
    private readonly onVramFailure: () => void,
    private readonly layersPerArray = GL_ATLAS_LAYERS,
  ) {}

  get arrayCount(): number {
    return this.arrays.length;
  }

  array(i: number): WebGLTexture | undefined {
    return this.arrays[i];
  }

  sketchTexture(bmp: ImageBitmap): WebGLTexture | null {
    return this.sketch?.bmp === bmp ? this.sketch.tex : null;
  }

  slotOf(bmp: ImageBitmap): Slot | undefined {
    return this.slots.get(bmp);
  }

  /** On the GPU and drawable now. */
  ready(b: BrushGeom): boolean {
    return b.stratum === SKETCH_STRATUM ? this.sketch?.bmp === b.bmp : this.slots.has(b.bmp);
  }

  /** Frees layers of brushes no longer live and queues the new ones (sketch first: it is the base). */
  reconcile(live: readonly BrushGeom[]): void {
    const keep = new Set<ImageBitmap>();
    for (const b of live) if (b.stratum !== SKETCH_STRATUM) keep.add(b.bmp);
    for (const [bmp, slot] of this.slots) {
      if (keep.has(bmp)) continue;
      this.slots.delete(bmp);
      this.free.push(slot);
      this.version++;
    }
    const sketch = live.find((b) => b.stratum === SKETCH_STRATUM);
    this.sketchWanted = sketch?.bmp ?? null;
    if (this.sketch && this.sketch.bmp !== sketch?.bmp) {
      this.gl.deleteTexture(this.sketch.tex);
      this.sketch = null;
      this.version++;
    }
    const queued = new Set(this.queue);
    this.queue = this.queue.filter((bmp) => keep.has(bmp) || bmp === sketch?.bmp);
    if (sketch && !this.sketch && !queued.has(sketch.bmp)) this.queue.unshift(sketch.bmp);
    for (const b of live) {
      if (b.stratum === SKETCH_STRATUM || this.slots.has(b.bmp) || queued.has(b.bmp)) continue;
      if (b.bmp.width === TILE && b.bmp.height === TILE) this.queue.push(b.bmp);
    }
  }

  /** Uploads queued bitmaps (coarse first) until `budgetMs` is spent; at least one per call. */
  upload(budgetMs: number, now: () => number = () => performance.now()): number {
    const t0 = now();
    let n = 0;
    while (this.queue.length > 0 && (n === 0 || now() - t0 < budgetMs)) {
      const bmp = this.queue.shift();
      if (!bmp) break;
      if (!this.put(bmp)) break;
      n++;
      this.version++;
    }
    return n;
  }

  pending(): number {
    return this.queue.length;
  }

  dispose(): void {
    for (const t of this.arrays) this.gl.deleteTexture(t);
    if (this.sketch) this.gl.deleteTexture(this.sketch.tex);
    this.arrays.length = 0;
    this.free.length = 0;
    this.slots.clear();
    this.queue = [];
    this.sketch = null;
    this.sketchWanted = null;
  }

  /** False stops this frame's uploads (no VRAM); a bitmap that fails to upload is dropped. */
  private put(bmp: ImageBitmap): boolean {
    if (bmp === this.sketchWanted) return this.putSketch(bmp);
    const gl = this.gl;
    const slot = this.free.pop() ?? this.grow();
    if (!slot) {
      this.queue.unshift(bmp); // keep it for when eviction makes room
      return false;
    }
    try {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrays[slot.array] ?? null);
      this.unpack();
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, slot.layer, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      this.slots.set(bmp, slot);
    } catch {
      this.free.push(slot); // closed under us: its brush left the book, the next reconcile agrees
    }
    return true;
  }

  private putSketch(bmp: ImageBitmap): boolean {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return false;
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      this.params(gl.TEXTURE_2D);
      this.unpack();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    } catch {
      gl.deleteTexture(tex);
      return true;
    }
    if (this.sketch) gl.deleteTexture(this.sketch.tex);
    this.sketch = { bmp, tex };
    return true;
  }

  /** A new array of layers; a failed reservation is §5.2.3's VRAM pressure signal. */
  private grow(): Slot | null {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE, TILE, this.layersPerArray);
    if (gl.getError() === gl.OUT_OF_MEMORY) {
      gl.deleteTexture(tex);
      this.onVramFailure();
      return null;
    }
    this.params(gl.TEXTURE_2D_ARRAY);
    const array = this.arrays.push(tex) - 1;
    for (let layer = this.layersPerArray - 1; layer > 0; layer--) this.free.push({ array, layer });
    return { array, layer: 0 };
  }

  private params(target: number): void {
    const gl = this.gl;
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  /** Bitmaps are opaque sRGB bytes already: no flip, premultiply or colour conversion. */
  private unpack(): void {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }
}
