import { TILE } from '@/shared/config/constants';
import { GL_ATLAS_LAYERS } from '@/shared/config/render';
import { uploadLayer, type AtlasGL, type Slot } from './atlas-gl';
import { LayerArrays } from './layer-arrays';
import { SketchTexture } from './sketch-texture';
import { SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';

export type { AtlasGL };

/** What the atlas tells its owner about the pixels it holds. */
export interface AtlasEvents {
  /** A tile is on the GPU: its bitmap is no longer needed here. */
  uploaded(b: BrushGeom): void;
  /** A live tile has neither a bitmap nor a layer (a new context, a lost texture): its pixels must be rebuilt. */
  needPixels(b: BrushGeom): void;
}

const NO_EVENTS: AtlasEvents = { uploaded: () => undefined, needPixels: () => undefined };

/**
 * Spec §5.1 VRAM: one RGBA8 256² layer of a TEXTURE_2D_ARRAY per owned brush, in arrays of
 * GL_ATLAS_LAYERS layers (an array with no brush left is deleted); the sketch (seed-sized) gets its own 2D texture. Layers are keyed by
 * the identity of the brush's landed bitmap (`BrushGeom.image`), which outlives the bitmap itself:
 * a brush that leaves the book (RASPAR, expiry, SOLTAR) frees its layer at the next reconcile,
 * which runs before the next paint.
 */
export class TileAtlas {
  private readonly layers: LayerArrays;
  private readonly slots = new Map<number, Slot>();
  private queue: BrushGeom[] = [];
  private readonly sketch: SketchTexture;
  /** The live sketch's image, known from the brush list (never guessed from its size). */
  private sketchWanted = 0;
  /** Bumped whenever the set of drawable brushes changes (upload or free). */
  version = 0;

  constructor(
    private readonly gl: AtlasGL,
    onVramFailure: () => void,
    layersPerArray = GL_ATLAS_LAYERS,
    private readonly events: AtlasEvents = NO_EVENTS,
  ) {
    this.layers = new LayerArrays(gl, layersPerArray, onVramFailure);
    this.sketch = new SketchTexture(gl);
  }

  get arrayCount(): number {
    return this.layers.count;
  }

  array(i: number): WebGLTexture | undefined {
    return this.layers.array(i);
  }

  sketchTexture(image: number): WebGLTexture | null {
    return this.sketch.texture(image);
  }

  slotOf(image: number): Slot | undefined {
    return this.slots.get(image);
  }

  /** On the GPU and drawable now. */
  ready(b: BrushGeom): boolean {
    return b.stratum === SKETCH_STRATUM ? this.sketch.has(b.image) : this.slots.has(b.image);
  }

  /** Frees layers of brushes no longer live and queues the new ones (sketch first: it is the base). */
  reconcile(live: readonly BrushGeom[]): void {
    const keep = new Set<number>();
    for (const b of live) if (b.stratum !== SKETCH_STRATUM) keep.add(b.image);
    let freed = false;
    for (const [image, slot] of this.slots) {
      if (keep.has(image)) continue;
      this.slots.delete(image);
      this.layers.give(slot);
      freed = true;
      this.version++;
    }
    if (freed) this.layers.trim();
    const sketch = live.find((b) => b.stratum === SKETCH_STRATUM);
    this.sketchWanted = sketch?.image ?? 0;
    if (this.sketch.keepOnly(this.sketchWanted)) this.version++;
    const queued = new Set(this.queue.map((b) => b.image));
    this.queue = this.queue.filter((b) => keep.has(b.image) || b.image === this.sketchWanted);
    if (sketch?.bmp && !this.sketch.loaded && !queued.has(sketch.image)) this.queue.unshift(sketch);
    for (const b of live) {
      if (b.stratum === SKETCH_STRATUM || this.slots.has(b.image) || queued.has(b.image)) continue;
      if (!b.bmp) this.events.needPixels(b);
      else if (b.pw === TILE && b.ph === TILE) this.queue.push(b);
    }
  }

  /** Uploads queued bitmaps (coarse first) until `budgetMs` is spent; at least one per call. */
  upload(budgetMs: number, now: () => number = () => performance.now()): number {
    const t0 = now();
    let n = 0;
    while (this.queue.length > 0 && (n === 0 || now() - t0 < budgetMs)) {
      const b = this.queue.shift();
      if (!b) break;
      if (!this.put(b)) break;
      n++;
      this.version++;
    }
    return n;
  }

  pending(): number {
    return this.queue.length;
  }

  dispose(): void {
    this.layers.dispose();
    this.sketch.dispose();
    this.forget();
  }

  /** Drops every reference with no GL call: the context that owned the textures is lost. */
  forget(): void {
    this.layers.forget();
    this.slots.clear();
    this.queue = [];
    this.sketch.forget();
    this.sketchWanted = 0;
  }

  /** False stops this frame's uploads (no VRAM); a bitmap that fails to upload is dropped. */
  private put(b: BrushGeom): boolean {
    const bmp = b.bmp;
    if (!bmp) return true;
    if (b.image === this.sketchWanted) return this.sketch.put(b.image, bmp);
    const slot = this.layers.take();
    if (!slot) {
      this.queue.unshift(b); // keep it for when eviction makes room
      return false;
    }
    try {
      uploadLayer(this.gl, this.layers.array(slot.array) ?? null, slot.layer, bmp);
      this.slots.set(b.image, slot);
    } catch {
      this.layers.give(slot); // closed under us: its brush left the book, the next reconcile agrees
      return true;
    }
    this.events.uploaded(b);
    return true;
  }
}
