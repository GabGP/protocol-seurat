import { clamp } from '@/shared/lib/clamp';
import {
  TAU, BG_COLOR, IMAGE_SMOOTHING_THRESHOLD, DOT_FADE_RAMP_FACTOR, MAX_BACKGROUND_DIM,
  FRAME_SHADOW_PADDING, FRAME_SHADOW_OFFSET_Y, FRAME_SHADOW_MARGIN,
  LOUPE_RADIUS, LOUPE_PIXEL_OUTLINE_ZOOM, LOUPE_PIXEL_OUTLINE_WIDTH, LOUPE_RIM_WIDTH,
  LOADER_COLORS, ACCENT_COLOR, FRAME_FILL_COLOR, PIXEL_OUTLINE_COLOR,
} from '@/shared/config/render';
import { forEachLoaderDot } from '../lib/loader-dots';
import { drawPointillism } from '../lib/pointillism';
import { BrushCuller, SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';
import { ViewerSprites } from './render-sprites';
import { snapSpan, tilesCover } from './tile-cover';
import type { FrameState, LoaderState, ViewRenderer } from '../model/view-renderer';

/** The Canvas2D path: one drawImage per visible brush. The fallback when WebGL2 is unavailable. */
export class Canvas2DRenderer implements ViewRenderer {
  readonly kind = 'canvas2d' as const;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly sprites = new ViewerSprites();
  private readonly mainCuller = new BrushCuller();
  private readonly loupeCuller = new BrushCuller();
  private readonly visible: BrushGeom[] = [];
  private W = 0;
  private H = 0;
  private dpr = 1;
  private drawn = 0;

  constructor(canvas: HTMLCanvasElement) {
    // Opaque: every frame paints the background first, and the compositor can skip blending.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('canvas2d unavailable');
    this.ctx = ctx;
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.sprites.ensure(this.ctx, dpr);
  }

  dispose(): void {
    // Nothing to free: the context goes with its canvas.
  }

  render(f: FrameState): number {
    const ctx = this.ctx;
    this.drawn = 0;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const iw = f.iw * f.s;
    const ih = f.ih * f.s;
    // The sketch spans the whole image and is opaque: no background (or black) is needed under it.
    const sketched = f.brushes[0]?.stratum === SKETCH_STRATUM;
    this.sprites.drawBackground(ctx, this.W, this.H, f.tx, f.ty, f.flags.grid,
      sketched ? { x0: f.tx, y0: f.ty, x1: f.tx + iw, y1: f.ty + ih } : null);
    if (
      f.tx > -FRAME_SHADOW_PADDING ||
      f.ty > -FRAME_SHADOW_PADDING ||
      f.tx + iw < this.W + FRAME_SHADOW_PADDING ||
      f.ty + ih < this.H + FRAME_SHADOW_PADDING
    ) {
      const m = FRAME_SHADOW_MARGIN;
      const fx = Math.max(f.tx, -m);
      const fy = Math.max(f.ty, -m);
      const fw = Math.min(f.tx + iw, this.W + m) - fx;
      const fh = Math.min(f.ty + ih, this.H + m) - fy;
      if (f.flags.shadow) this.sprites.drawFrameShadow(ctx, fx, fy, fw, fh, FRAME_SHADOW_OFFSET_Y);
      if (!sketched) {
        ctx.fillStyle = FRAME_FILL_COLOR;
        ctx.fillRect(fx, fy, fw, fh);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(f.tx, f.ty, iw, ih);
    ctx.clip();
    this.layer(f, f.tx, f.ty, f.s, 0, 0, this.W, this.H, this.mainCuller);
    ctx.restore();
    if (f.loupe) this.loupe(f, f.loupe);
    return this.drawn;
  }

  renderLoader(l: LoaderState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.sprites.drawBackground(ctx, this.W, this.H, l.tx, l.ty, l.flags.grid, null);
    forEachLoaderDot(l.t, this.W, this.H, (i, x, y, r) => {
      ctx.fillStyle = LOADER_COLORS[i % LOADER_COLORS.length] ?? ACCENT_COLOR;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    });
  }

  /** Brushes (culled, opaque), then the dot mask laid over them once dots are on. */
  private layer(f: FrameState, tx: number, ty: number, s: number, cx0: number, cy0: number, cx1: number, cy1: number,
    culler: BrushCuller): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const list = culler.cull(f.brushes, s * dpr, f.iw, f.ih, f.flags.cull, f.flags.lod);
    if (list.length === 0) return;
    const seen = this.visible;
    seen.length = 0;
    for (const b of list) {
      const dx = tx + b.x * s;
      const dy = ty + b.y * s;
      if (dx + b.w * s < cx0 || dx > cx1 || dy + b.h * s < cy0 || dy > cy1) continue;
      seen.push(b);
    }
    // Outside dots, tiles snap to whole device px and abut exactly, so once they cover the view
    // the sketch under them (a full-view upscale) is pure overdraw. Dots keep exact placement:
    // the dot grid is locked to the unsnapped pixel grid.
    const th = f.dotThreshold;
    const snap = s < th;
    const skipSketch = snap && f.flags.cull && seen[0]?.stratum === SKETCH_STRATUM
      && tilesCover(seen, { x0: (cx0 - tx) / s, y0: (cy0 - ty) / s, x1: (cx1 - tx) / s, y1: (cy1 - ty) / s }, f.iw, f.ih);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = s < IMAGE_SMOOTHING_THRESHOLD;
    for (const b of seen) {
      if (skipSketch && b.stratum === SKETCH_STRATUM) continue;
      if (snap) {
        const [x, w] = snapSpan(tx + b.x * s, tx + (b.x + b.w) * s, dpr);
        const [y, h] = snapSpan(ty + b.y * s, ty + (b.y + b.h) * s, dpr);
        ctx.drawImage(b.bmp, x, y, w, h);
      } else {
        ctx.drawImage(b.bmp, tx + b.x * s, ty + b.y * s, b.w * s, b.h * s);
      }
      this.drawn++;
    }
    if (f.flags.dots && s >= th) { // always dots once a pixel is big enough to hold several
      const amount = Math.min(1, (s - th) / (th * DOT_FADE_RAMP_FACTOR)) * MAX_BACKGROUND_DIM;
      drawPointillism(ctx, { tx, ty, s, cx0, cy0, cx1, cy1, amount, under: BG_COLOR });
    }
  }

  private loupe(f: FrameState, { mx, my, L }: { mx: number; my: number; L: number }): void {
    const ctx = this.ctx;
    const R = LOUPE_RADIUS;
    const ix = clamp((mx - f.tx) / f.s, 0, f.iw);
    const iy = clamp((my - f.ty) / f.s, 0, f.ih);
    const ltx = mx - ix * L;
    const lty = my - iy * L;
    this.sprites.drawLoupeDisc(ctx, mx, my);
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, R, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(ltx, lty, f.iw * L, f.ih * L);
    ctx.clip();
    this.layer(f, ltx, lty, L, mx - R, my - R, mx + R, my + R, this.loupeCuller);
    if (L >= LOUPE_PIXEL_OUTLINE_ZOOM) {
      ctx.strokeStyle = PIXEL_OUTLINE_COLOR;
      ctx.lineWidth = LOUPE_PIXEL_OUTLINE_WIDTH;
      ctx.strokeRect(ltx + Math.floor(ix) * L, lty + Math.floor(iy) * L, L, L);
    }
    ctx.restore();
    ctx.lineWidth = LOUPE_RIM_WIDTH;
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.beginPath();
    ctx.arc(mx, my, R, 0, TAU);
    ctx.stroke();
  }
}
