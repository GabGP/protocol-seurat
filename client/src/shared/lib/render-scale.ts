import { RENDER_MAX_BACKING_PX, RENDER_SCALE_EPSILON, RENDER_SCALE_STEPS } from '@/shared/config/render';

/** The render-scale setting: `auto`, or one of `RENDER_SCALE_STEPS`. */
export type RenderScaleSetting = 'auto' | number;

/** A setting read from storage or the URL: `auto` or exactly one of the steps, else null. */
export function parseRenderScale(v: unknown): RenderScaleSetting | null {
  if (v === 'auto') return 'auto';
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && RENDER_SCALE_STEPS.includes(n) ? n : null;
}

/**
 * The scale that keeps the backing store (css × dpr × scale)² within RENDER_MAX_BACKING_PX,
 * snapped down onto a step (never below the smallest one).
 */
export function autoRenderScale(cssW: number, cssH: number, dpr: number): number {
  const px = cssW * cssH * dpr * dpr;
  const fit = px > 0 ? Math.min(1, Math.sqrt(RENDER_MAX_BACKING_PX / px)) : 1;
  const steps = RENDER_SCALE_STEPS;
  return steps.find((s) => s <= fit + RENDER_SCALE_EPSILON) ?? steps[steps.length - 1] ?? 1;
}

/** What the setting means for this canvas: a fixed step as is, `auto` from the size. */
export function effectiveRenderScale(setting: RenderScaleSetting, cssW: number, cssH: number, dpr: number): number {
  return setting === 'auto' ? autoRenderScale(cssW, cssH, dpr) : setting;
}

/** The canvas backing store, and the MIRADA `vw` × `vh` (spec 2.2: device px), for a css size at `dpr` (device dpr × scale). */
export function backingPx(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  return { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr) };
}
