import { clamp } from '@/shared/lib/clamp';
import {
  TAU, LOUPE_RADIUS, LOUPE_PIXEL_OUTLINE_ZOOM, LOUPE_PIXEL_OUTLINE_WIDTH, LOUPE_RIM_WIDTH,
  ACCENT_COLOR, PIXEL_OUTLINE_COLOR,
} from '@/shared/config/render';
import type { FrameState } from '../model/view-renderer';
import type { ViewerSprites } from './render-sprites';

/** Paints the brushes of the loupe's magnified view into the clip the loupe sets up. */
export type LoupeLayer = (tx: number, ty: number, s: number, cx0: number, cy0: number, cx1: number, cy1: number) => void;

/** The loupe: a disc showing the image at zoom L around the cursor, with a pixel outline at high zoom. */
export function drawLoupe(
  ctx: CanvasRenderingContext2D, sprites: ViewerSprites, f: FrameState,
  { mx, my, L }: { mx: number; my: number; L: number }, layer: LoupeLayer,
): void {
  const R = LOUPE_RADIUS;
  const ix = clamp((mx - f.tx) / f.s, 0, f.iw);
  const iy = clamp((my - f.ty) / f.s, 0, f.ih);
  const ltx = mx - ix * L;
  const lty = my - iy * L;
  sprites.drawLoupeDisc(ctx, mx, my);
  ctx.save();
  ctx.beginPath();
  ctx.arc(mx, my, R, 0, TAU);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(ltx, lty, f.iw * L, f.ih * L);
  ctx.clip();
  layer(ltx, lty, L, mx - R, my - R, mx + R, my + R);
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
