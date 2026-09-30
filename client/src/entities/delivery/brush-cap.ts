import {
  BRUSH_CAP_AUTO,
  BRUSH_CAP_AUTO_FLOOR_K,
  BRUSH_CAP_AUTO_K,
  BRUSH_CAP_AUTO_MAX,
  BRUSH_CAP_AUTO_MIN,
  BRUSH_CAP_DEFAULT,
  BRUSH_CAP_KEY,
  DEFAULT_STRATA,
  TILE,
} from '@/shared/config/constants';

/** The user's Settings choice: BRUSH_CAP_AUTO (0) until they pick a number. */
let chosen: number | null = null;
/** Auto's number for the last viewport the sink was told about. */
let auto = BRUSH_CAP_DEFAULT;
const listeners = new Set<() => void>();

function load(): number {
  try {
    const n = Number(localStorage.getItem(BRUSH_CAP_KEY));
    return Number.isInteger(n) && n > 0 ? n : BRUSH_CAP_AUTO;
  } catch {
    return BRUSH_CAP_AUTO;
  }
}

/** Tiles the backing store (device px) covers, with a tile of slack per side. */
export function brushesPerScreen(vw: number, vh: number): number {
  return Math.ceil(vw / TILE + 1) * Math.ceil(vh / TILE + 1);
}

/** Auto's cap for a viewport: K screens of tiles within the bounds, and never under the core plus the first ring (the view would stall). */
export function autoCap(vw: number, vh: number): number {
  const screen = brushesPerScreen(vw, vh);
  const n = Math.round(BRUSH_CAP_AUTO_K * screen);
  const floor = BRUSH_CAP_AUTO_FLOOR_K * screen + DEFAULT_STRATA + 1;
  return Math.max(floor, Math.min(BRUSH_CAP_AUTO_MAX, Math.max(BRUSH_CAP_AUTO_MIN, n)));
}

/** What Settings remembers: a number, or BRUSH_CAP_AUTO. */
export function capChoice(): number {
  chosen ??= load();
  return chosen;
}

/** Auto's current number (what "Auto (N)" shows). */
export function autoBrushCap(): number {
  return auto;
}

/** How many brushes this viewer holds at most (the user's choice, else auto; the server's grant can only lower it). */
export function brushCap(): number {
  return capChoice() > 0 ? capChoice() : auto;
}

function notify(before: number, choiceBefore: number, autoBefore: number): void {
  if (before === brushCap() && choiceBefore === capChoice() && autoBefore === auto) return;
  for (const fn of [...listeners]) fn();
}

/** Remembered in this browser (BRUSH_CAP_AUTO forgets it); open sinks re-evaluate their window and pressure through `onBrushCap`. */
export function setBrushCap(n: number): void {
  const before = brushCap();
  const choiceBefore = capChoice();
  const v = Math.max(0, Math.floor(n));
  chosen = v;
  try {
    if (v > 0) localStorage.setItem(BRUSH_CAP_KEY, String(v));
    else localStorage.removeItem(BRUSH_CAP_KEY);
  } catch {
    /* storage unavailable: the choice lasts only for this page */
  }
  notify(before, choiceBefore, auto);
}

/** The backing store the renderer draws (MIRADA `vw` × `vh`) changed: auto follows it, and a resize or render scale re-evaluates the cap. */
export function setViewport(vw: number, vh: number): void {
  const next = autoCap(vw, vh);
  if (next === auto) return;
  const before = brushCap();
  const autoBefore = auto;
  auto = next;
  notify(before, capChoice(), autoBefore);
}

/** Subscribe to cap changes; returns the unsubscribe. */
export function onBrushCap(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
