import { BRUSH_CAP_DEFAULT, BRUSH_CAP_KEY } from '@/shared/config/constants';

let cap: number | null = null;
const listeners = new Set<() => void>();

function load(): number {
  try {
    const n = Number(localStorage.getItem(BRUSH_CAP_KEY));
    return Number.isInteger(n) && n > 0 ? n : BRUSH_CAP_DEFAULT;
  } catch {
    return BRUSH_CAP_DEFAULT;
  }
}

/** How many brushes this viewer holds at most (the user's Settings choice; the server's grant can only lower it). */
export function brushCap(): number {
  cap ??= load();
  return cap;
}

/** Remembered in this browser; open sinks re-evaluate their window and pressure through `onBrushCap`. */
export function setBrushCap(n: number): void {
  const v = Math.max(1, Math.floor(n));
  if (v === brushCap()) return;
  cap = v;
  try {
    localStorage.setItem(BRUSH_CAP_KEY, String(v));
  } catch {
    /* storage unavailable: the choice lasts only for this page */
  }
  for (const fn of [...listeners]) fn();
}

/** Subscribe to cap changes; returns the unsubscribe. */
export function onBrushCap(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
