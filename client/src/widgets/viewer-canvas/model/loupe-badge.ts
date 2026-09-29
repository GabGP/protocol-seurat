import type { PointerState } from '@/features/pan-view';
import {
  LOUPE_BADGE_FLIP_PX,
  LOUPE_BADGE_HEIGHT,
  LOUPE_BADGE_OFFSET_Y,
  LOUPE_MAGNIFICATION,
  LOUPE_RADIUS,
} from '@/shared/config/render';

export interface Loupe {
  mx: number;
  my: number;
  /** Loupe zoom (image px → CSS px). */
  L: number;
}

/** The loupe for this frame, or null when it is off, has no pointer, or the view is being dragged. */
export function loupeAt(on: boolean, ptr: PointerState, dragging: boolean, s: number, maxS: number): Loupe | null {
  const shown = on && ptr.mouse !== null && (!dragging || ptr.loupeDrag);
  if (!shown || !ptr.mouse) return null;
  return { mx: ptr.mouse.mx, my: ptr.mouse.my, L: Math.min(s * LOUPE_MAGNIFICATION, maxS * LOUPE_MAGNIFICATION) };
}

/** The loupe's `×4 · N%` pill: DOM over the canvas (both renderers), moved by transform only. */
export function placeBadge(el: HTMLElement | null, loupe: Loupe | null, H: number): void {
  if (!el) return;
  el.hidden = loupe === null;
  if (!loupe) return;
  const pct = Math.round(loupe.L * 100);
  const text = `×${LOUPE_MAGNIFICATION} · ${pct < 1000 ? pct : pct.toLocaleString('en-US')}%`;
  if (el.textContent !== text) el.textContent = text;
  const R = LOUPE_RADIUS;
  const flip = loupe.my + R + LOUPE_BADGE_FLIP_PX > H;
  const by = flip ? loupe.my - R - LOUPE_BADGE_HEIGHT - LOUPE_BADGE_OFFSET_Y : loupe.my + R + LOUPE_BADGE_OFFSET_Y;
  el.style.transform = `translate(${loupe.mx}px, ${by}px) translateX(-50%)`;
}
