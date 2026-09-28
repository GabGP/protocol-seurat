import {
  TAU, BG_COLOR, BG_GRID_COLOR, BG_GRID_SPACING, BG_GRID_DOT_RADIUS, BG_GRID_PARALLAX, IMAGE_SMOOTHING_THRESHOLD,
  FRAME_SHADOW_PADDING, FRAME_SHADOW_OFFSET_Y, FRAME_SHADOW_MARGIN, FRAME_SHADOW_COLOR, FRAME_SHADOW_SIGMA,
  LOADER_DOT_COUNT, LOADER_SPEED, LOADER_ORBIT_RADIUS, LOADER_ORBIT_PULSE, LOADER_DOT_BASE_RADIUS,
  GL_UPLOAD_BUDGET_MS, DOT_FADE_RAMP_FACTOR, MAX_BACKGROUND_DIM, DOT_TILE_CELLS,
  LOUPE_RADIUS, LOUPE_SHADOW_BLUR, LOUPE_SHADOW_COLOR, LOUPE_PIXEL_OUTLINE_ZOOM, LOUPE_PIXEL_OUTLINE_WIDTH, LOUPE_RIM_WIDTH,
} from '@/shared/config/render';
import { clamp } from '@/shared/lib/clamp';
import { dotParams, dotsPerSide } from './pointillism';
import { BrushCuller, SKETCH_STRATUM, type BrushGeom } from './brush-cull';
import { TileAtlas } from './tile-atlas';
import { arrayRuns, clipView, INSTANCE_FLOATS, packTiles, type PackView } from './gl-instances';
import { link, rgb, rgba, type GLProgram } from './gl-context';
import { BG_FS, DISC_FS, OUTLINE_FS, RECT_VS, SHADOW_FS, TILE_FS, TILE_VS } from './gl-shaders';
import type { FrameState, LoaderState, ViewRenderer } from './view-renderer';

const STRIDE = INSTANCE_FLOATS * 4;
const LOADER_COLORS = ['#B8C4FF', '#FF8A5B', '#DDE1F9', '#FFB599'].map(rgb);
const BG = rgb(BG_COLOR);
const GRID_DOT = rgba(BG_GRID_COLOR);
const SHADOW_ALPHA = rgba(FRAME_SHADOW_COLOR)[3];
const LOUPE_SHADOW = rgba(LOUPE_SHADOW_COLOR);
const RIM = rgb('#B8C4FF');

/** Per-layer extras for the tile pass: the dot mask and the loupe's circular clip. */
interface LayerOpts {
  dots: number;
  clip: readonly [number, number, number] | null;
}

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
  private readonly bg: GLProgram;
  private readonly shadow: GLProgram;
  private readonly tile: GLProgram;
  private readonly disc: GLProgram;
  private readonly outline: GLProgram;
  private readonly dotTile: WebGLTexture | null;
  private readonly empty: WebGLVertexArrayObject | null;
  private readonly tiles: WebGLVertexArrayObject | null;
  private readonly buffer: WebGLBuffer | null;
  private readonly linear: WebGLSampler | null;
  private readonly nearest: WebGLSampler | null;
  private readonly mainCuller = new BrushCuller();
  private readonly loupeCuller = new BrushCuller();
  private inst = new Float32Array(INSTANCE_FLOATS * 64);
  private lastBrushes: readonly BrushGeom[] | null = null;
  private ready: { src: readonly BrushGeom[]; version: number; list: BrushGeom[] } | null = null;
  private W = 0;
  private H = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement, hooks: GLHooks) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.atlas = new TileAtlas(gl, () => hooks.onVramFailure());
    this.bg = link(gl, RECT_VS, BG_FS);
    this.shadow = link(gl, RECT_VS, SHADOW_FS);
    this.tile = link(gl, TILE_VS, TILE_FS);
    this.disc = link(gl, RECT_VS, DISC_FS);
    this.outline = link(gl, RECT_VS, OUTLINE_FS);
    this.dotTile = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.dotTile);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, DOT_TILE_CELLS, DOT_TILE_CELLS, 0, gl.RGBA, gl.UNSIGNED_BYTE, dotParams());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.empty = gl.createVertexArray();
    this.tiles = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.tiles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let a = 0; a < 4; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    gl.bindVertexArray(null);
    this.linear = this.sampler(gl.LINEAR);
    this.nearest = this.sampler(gl.NEAREST);
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Uploads still queued: keep painting frames until they land. */
  needsFrame(): boolean {
    return this.atlas.pending() > 0;
  }

  dispose(): void {
    const gl = this.gl;
    this.atlas.dispose();
    for (const p of [this.bg, this.shadow, this.tile, this.disc, this.outline]) gl.deleteProgram(p.program);
    gl.deleteTexture(this.dotTile);
    gl.deleteVertexArray(this.empty);
    gl.deleteVertexArray(this.tiles);
    gl.deleteBuffer(this.buffer);
    gl.deleteSampler(this.linear);
    gl.deleteSampler(this.nearest);
  }

  render(f: FrameState): number {
    const gl = this.gl;
    if (gl.isContextLost()) return 0;
    if (f.brushes !== this.lastBrushes) {
      this.atlas.reconcile(f.brushes);
      this.lastBrushes = f.brushes;
    }
    this.atlas.upload(GL_UPLOAD_BUDGET_MS);
    const ready = this.readyList(f.brushes);
    this.background(f.tx, f.ty, f.flags.grid);
    const iw = f.iw * f.s;
    const ih = f.ih * f.s;
    const sketched = ready[0]?.stratum === SKETCH_STRATUM;
    if (f.tx > -FRAME_SHADOW_PADDING || f.ty > -FRAME_SHADOW_PADDING
      || f.tx + iw < this.W + FRAME_SHADOW_PADDING || f.ty + ih < this.H + FRAME_SHADOW_PADDING) {
      const m = FRAME_SHADOW_MARGIN;
      const x0 = Math.max(f.tx, -m);
      const y0 = Math.max(f.ty, -m);
      const x1 = Math.min(f.tx + iw, this.W + m);
      const y1 = Math.min(f.ty + ih, this.H + m);
      if (f.flags.shadow) this.frameShadow(x0, y0 + FRAME_SHADOW_OFFSET_Y, x1, y1 + FRAME_SHADOW_OFFSET_Y);
      if (!sketched) this.fill(x0, y0, x1, y1, [0, 0, 0]);
    }
    let drawn = 0;
    const v = clipView(f.tx, f.ty, f.s, f.iw, f.ih, 0, 0, this.W, this.H, this.dpr);
    if (v) {
      const list = this.mainCuller.cull(ready, f.s * this.dpr, f.iw, f.ih, f.flags.cull, f.flags.lod);
      drawn += this.drawBrushes(list, v, f.s, { dots: this.dotsAt(f, f.s), clip: null });
    }
    if (f.loupe) drawn += this.loupe(f, ready, f.loupe);
    return drawn;
  }

  /** Gap fade of the dot mask at zoom `s` (0 below the threshold), as in the Canvas2D path. */
  private dotsAt(f: FrameState, s: number): number {
    const th = f.dotThreshold;
    if (!f.flags.dots || s < th) return 0;
    return Math.min(1, (s - th) / (th * DOT_FADE_RAMP_FACTOR)) * MAX_BACKGROUND_DIM;
  }

  /** Shadowed disc, the image at `L` clipped to it (dots included), pixel box and rim. */
  private loupe(f: FrameState, ready: BrushGeom[], { mx, my, L }: { mx: number; my: number; L: number }): number {
    const R = LOUPE_RADIUS;
    const ix = clamp((mx - f.tx) / f.s, 0, f.iw);
    const iy = clamp((my - f.ty) / f.s, 0, f.ih);
    const ltx = mx - ix * L;
    const lty = my - iy * L;
    const clip = [mx, my, R] as const;
    this.discShape(mx, my, R, 0, LOUPE_SHADOW_BLUR / 2, LOUPE_SHADOW);
    this.discShape(mx, my, R, 0, 0, [BG[0], BG[1], BG[2], 1]);
    let drawn = 0;
    const v = clipView(ltx, lty, L, f.iw, f.ih, mx - R, my - R, mx + R, my + R, this.dpr);
    if (v) {
      const list = this.loupeCuller.cull(ready, L * this.dpr, f.iw, f.ih, f.flags.cull, f.flags.lod);
      drawn = this.drawBrushes(list, v, L, { dots: this.dotsAt(f, L), clip });
    }
    if (L >= LOUPE_PIXEL_OUTLINE_ZOOM) {
      const x0 = ltx + Math.floor(ix) * L;
      const y0 = lty + Math.floor(iy) * L;
      this.outlineBox(x0, y0, x0 + L, y0 + L, LOUPE_PIXEL_OUTLINE_WIDTH, clip);
    }
    this.discShape(mx, my, R, LOUPE_RIM_WIDTH, 0, [RIM[0], RIM[1], RIM[2], 1]);
    return drawn;
  }

  private outlineBox(x0: number, y0: number, x1: number, y1: number, width: number,
    clip: readonly [number, number, number]): void {
    const gl = this.gl;
    const e = width;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.empty);
    this.outline.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr)
      .f4('uRect', x0 - e, y0 - e, x1 + e, y1 + e).f4('uBox', x0, y0, x1, y1).f1('uWidth', width)
      .f4('uColor', 1, 1, 1, 1).f3('uClip', clip);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  renderLoader(l: LoaderState): void {
    if (this.gl.isContextLost()) return;
    this.atlas.upload(GL_UPLOAD_BUDGET_MS);
    this.background(l.tx, l.ty, l.flags.grid);
    for (let i = 0; i < LOADER_DOT_COUNT; i++) {
      const a = l.t * LOADER_SPEED + i * (TAU / LOADER_DOT_COUNT);
      const R = LOADER_ORBIT_RADIUS + LOADER_ORBIT_PULSE * Math.sin(l.t * 3 + i);
      const r = LOADER_DOT_BASE_RADIUS + LOADER_DOT_BASE_RADIUS * (0.5 + 0.5 * Math.sin(l.t * 4 - i * 0.7));
      const c = LOADER_COLORS[i % 4] ?? [1, 1, 1];
      this.discShape(this.W / 2 + Math.cos(a) * R, this.H / 2 + Math.sin(a) * R, r, 0, 0, [c[0], c[1], c[2], 1]);
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

  private background(tx: number, ty: number, grid: boolean): void {
    const gl = this.gl;
    const g = BG_GRID_SPACING;
    const dot = GRID_DOT;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.empty);
    this.bg.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr)
      .f4('uRect', 0, 0, this.W, this.H).f3('uBg', BG).f4('uDot', dot[0], dot[1], dot[2], dot[3])
      .f2('uOffset', (((tx * BG_GRID_PARALLAX) % g) + g) % g, (((ty * BG_GRID_PARALLAX) % g) + g) % g)
      .f1('uSpacing', g).f1('uRadius', BG_GRID_DOT_RADIUS).i1('uGrid', grid ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private frameShadow(x0: number, y0: number, x1: number, y1: number): void {
    const gl = this.gl;
    const reach = 3 * FRAME_SHADOW_SIGMA;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.empty);
    this.shadow.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr)
      .f4('uRect', x0 - reach, y0 - reach, x1 + reach, y1 + reach).f4('uBox', x0, y0, x1, y1)
      .f1('uSigma', FRAME_SHADOW_SIGMA).f1('uAlpha', SHADOW_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** Solid CSS rect via a scissored clear (no program needed). */
  private fill(x0: number, y0: number, x1: number, y1: number, c: readonly [number, number, number]): void {
    const gl = this.gl;
    const d = this.dpr;
    const X0 = Math.max(0, Math.round(x0 * d));
    const X1 = Math.min(this.canvas.width, Math.round(x1 * d));
    const Y0 = Math.max(0, Math.round(y0 * d));
    const Y1 = Math.min(this.canvas.height, Math.round(y1 * d));
    if (X1 <= X0 || Y1 <= Y0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(X0, this.canvas.height - Y1, X1 - X0, Y1 - Y0);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  private discShape(cx: number, cy: number, r: number, ring: number, sigma: number,
    color: readonly [number, number, number, number]): void {
    const gl = this.gl;
    const e = r + ring + 3 * sigma + 1;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.empty);
    this.disc.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr)
      .f4('uRect', cx - e, cy - e, cx + e, cy + e).f2('uCenter', cx, cy).f1('uRadius', r)
      .f1('uRing', ring).f1('uSigma', sigma).f4('uColor', color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** Sketch, then tiles coarse → fine, one draw per run of tiles sharing a texture array; returns draws issued. */
  private drawBrushes(list: readonly BrushGeom[], v: PackView, s: number, opts: LayerOpts): number {
    const gl = this.gl;
    const need = (list.length + 1) * INSTANCE_FLOATS;
    if (this.inst.length < need) this.inst = new Float32Array(need * 2);
    const sketch = list[0]?.stratum === SKETCH_STRATUM ? list[0] : null;
    const tiles = sketch ? list.slice(1) : list;
    const groups: Array<{ first: number; count: number; array: number }> = [];
    let total = sketch ? packTiles([sketch], v, () => 0, this.inst) : 0;
    const sketchCount = total;
    for (const run of arrayRuns(tiles, (b) => this.atlas.slotOf(b.bmp)?.array)) {
      const count = packTiles(run.tiles, v, (b) => this.atlas.slotOf(b.bmp)?.layer ?? 0, this.inst, total);
      if (count > 0) groups.push({ first: total, count, array: run.array });
      total += count;
    }
    if (total === 0) return 0;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.tiles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, total * INSTANCE_FLOATS), gl.STREAM_DRAW);
    const smp = s < IMAGE_SMOOTHING_THRESHOLD ? this.linear : this.nearest;
    gl.bindSampler(0, smp);
    gl.bindSampler(1, smp);
    const n = dotsPerSide(s);
    const cells = DOT_TILE_CELLS;
    this.tile.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr)
      .i1('uTiles', 0).i1('uSketch', 1).i1('uDotTile', 2)
      .f1('uDots', opts.dots).f1('uDotsPerPx', n).f1('uCellDev', (s * this.dpr) / n)
      .f2('uCellOffset', (((v.ox * n) % cells) + cells) % cells, (((v.oy * n) % cells) + cells) % cells)
      .f3('uUnder', BG).f3('uClip', opts.clip ?? [0, 0, 0]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.dotTile);
    if (sketch && sketchCount > 0) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.sketchTexture(sketch.bmp));
      this.tile.i1('uIsSketch', 1);
      this.pointers(0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
    this.tile.i1('uIsSketch', 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const g of groups) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.array(g.array) ?? null);
      this.pointers(g.first);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.count);
    }
    return total;
  }

  /** Instance attributes start at instance `first` (WebGL2 has no base-instance draw). */
  private pointers(first: number): void {
    const gl = this.gl;
    const base = first * STRIDE;
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STRIDE, base);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, base + 16);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, base + 32);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, base + 48);
  }

  private sampler(filter: number): WebGLSampler | null {
    const gl = this.gl;
    const s = gl.createSampler();
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  }
}
