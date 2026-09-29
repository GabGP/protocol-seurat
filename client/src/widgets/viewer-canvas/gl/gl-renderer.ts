import {
  FRAME_SHADOW_MARGIN, FRAME_SHADOW_OFFSET_Y, FRAME_SHADOW_PADDING, GL_UPLOAD_BUDGET_MS,
} from '@/shared/config/render';
import { BrushCuller, SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';
import { clipView } from './gl-instances';
import { drawLoader } from './gl-loader';
import { GLLoupe } from './gl-loupe';
import { GLPrimitives } from './gl-primitives';
import { GLResources } from './gl-resources';
import { dotsAt, GLTilePass } from './gl-tile-pass';
import { TileAtlas } from './tile-atlas';
import type { FrameState, LoaderState, ViewRenderer } from '../model/view-renderer';

export interface GLHooks {
  /** A texture reservation failed: spec §5.2.3 voluntary eviction. */
  onVramFailure(): void;
}

/**
 * The WebGL2 path (spec §5.1): brushes live as texture-array layers uploaded once; a frame is a
 * background quad, the frame shadow, the sketch and one instanced draw per array.
 */
export class WebGL2Renderer implements ViewRenderer {
  readonly kind = 'webgl2' as const;
  private readonly gl: WebGL2RenderingContext;
  private readonly atlas: TileAtlas;
  private readonly res: GLResources;
  private readonly prims: GLPrimitives;
  private readonly pass: GLTilePass;
  private readonly loupe: GLLoupe;
  private readonly mainCuller = new BrushCuller();
  private lastBrushes: readonly BrushGeom[] | null = null;
  private ready: { src: readonly BrushGeom[]; version: number; list: BrushGeom[] } | null = null;

  constructor(canvas: HTMLCanvasElement, hooks: GLHooks) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.atlas = new TileAtlas(gl, () => hooks.onVramFailure());
    this.res = new GLResources(gl, canvas);
    this.prims = new GLPrimitives(this.res);
    this.pass = new GLTilePass(this.res, this.atlas);
    this.loupe = new GLLoupe(this.res, this.prims, this.pass);
  }

  resize(W: number, H: number, dpr: number): void {
    this.res.resize(W, H, dpr);
  }

  /** Uploads still queued: keep painting frames until they land. */
  needsFrame(): boolean {
    return this.atlas.pending() > 0;
  }

  dispose(): void {
    this.atlas.dispose();
    this.res.dispose();
  }

  render(f: FrameState): number {
    if (this.gl.isContextLost()) return 0;
    if (f.brushes !== this.lastBrushes) {
      this.atlas.reconcile(f.brushes);
      this.lastBrushes = f.brushes;
    }
    this.atlas.upload(GL_UPLOAD_BUDGET_MS);
    const ready = this.readyList(f.brushes);
    this.prims.background(f.tx, f.ty, f.flags.grid);
    this.frameBackdrop(f, ready[0]?.stratum === SKETCH_STRATUM);
    let drawn = 0;
    const { W, H, dpr } = this.res;
    const v = clipView(f.tx, f.ty, f.s, f.iw, f.ih, 0, 0, W, H, dpr);
    if (v) {
      const list = this.mainCuller.cull(ready, f.s * dpr, f.iw, f.ih, f.flags.cull, f.flags.lod);
      drawn += this.pass.draw(list, v, f.s, { dots: dotsAt(f, f.s), clip: null });
    }
    if (f.loupe) drawn += this.loupe.draw(f, ready, f.loupe);
    return drawn;
  }

  renderLoader(l: LoaderState): void {
    if (this.gl.isContextLost()) return;
    this.atlas.upload(GL_UPLOAD_BUDGET_MS);
    drawLoader(this.res, this.prims, l);
  }

  /** The frame's shadow and the black fill under a not-yet-sketched image, where the image edge is on screen. */
  private frameBackdrop(f: FrameState, sketched: boolean): void {
    const { W, H } = this.res;
    const iw = f.iw * f.s;
    const ih = f.ih * f.s;
    if (f.tx > -FRAME_SHADOW_PADDING || f.ty > -FRAME_SHADOW_PADDING
      || f.tx + iw < W + FRAME_SHADOW_PADDING || f.ty + ih < H + FRAME_SHADOW_PADDING) {
      const m = FRAME_SHADOW_MARGIN;
      const x0 = Math.max(f.tx, -m);
      const y0 = Math.max(f.ty, -m);
      const x1 = Math.min(f.tx + iw, W + m);
      const y1 = Math.min(f.ty + ih, H + m);
      if (f.flags.shadow) this.prims.frameShadow(x0, y0 + FRAME_SHADOW_OFFSET_Y, x1, y1 + FRAME_SHADOW_OFFSET_Y);
      if (!sketched) this.prims.fill(x0, y0, x1, y1, [0, 0, 0]);
    }
  }

  /** Brushes that are on the GPU now, stable per (list, atlas version) so culling can memoize. */
  private readyList(src: readonly BrushGeom[]): BrushGeom[] {
    const r = this.ready;
    if (r && r.src === src && r.version === this.atlas.version) return r.list;
    const list = src.filter((b) => this.atlas.ready(b));
    this.ready = { src, version: this.atlas.version, list };
    return list;
  }
}
