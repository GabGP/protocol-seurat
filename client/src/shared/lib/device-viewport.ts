import { deviceDpr } from './dpr';
import { backingPx, effectiveRenderScale } from './render-scale';
import { renderFlags } from './render-flags';

/** Backing pixels per CSS pixel for a canvas of this CSS size: the device's dpr times the render scale. */
export function backingDpr(cssW: number, cssH: number): number {
  const dpr = deviceDpr();
  return dpr * effectiveRenderScale(renderFlags.scale, cssW, cssH, dpr);
}

/** The MIRADA `vw` × `vh` for a canvas of this CSS size: the device px the renderer really draws (spec 2.2). */
export function deviceViewport(cssW: number, cssH: number): { vw: number; vh: number } {
  const { w, h } = backingPx(cssW, cssH, backingDpr(cssW, cssH));
  return { vw: w, vh: h };
}
