import { TAU, LOADER_COLORS, ACCENT_COLOR } from '@/shared/config/render';
import { forEachLoaderDot } from '../lib/loader-dots';
import type { LoaderState } from '../model/view-renderer';

/** The loading animation's dots, one per loader position, coloured from the loader palette. */
export function drawLoaderDots(ctx: CanvasRenderingContext2D, l: LoaderState, W: number, H: number): void {
  forEachLoaderDot(l.t, W, H, (i, x, y, r) => {
    ctx.fillStyle = LOADER_COLORS[i % LOADER_COLORS.length] ?? ACCENT_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  });
}
