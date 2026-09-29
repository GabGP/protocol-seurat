import { useSyncExternalStore } from 'react';
import { parseRenderScale, type RenderScaleSetting } from './render-scale';

/**
 * Viewer render switches for A/B measuring, set from the settings panel (remembered per browser)
 * and overridable with `?render=a,b` (before the `#` route): `nogrid`, `noshadow`, `nodots` switch
 * a layer off; `nocull` draws every stratum (old overdraw); `nolod` keeps coverage culling but
 * draws fine tiles even where a coarser one is already sharp; `blur` keeps the glass backdrop blur
 * while moving; `fps` shows the frame meter; `gpu` / `nogpu` pick the WebGL2 or Canvas2D renderer;
 * `scale:auto|1|0.75|0.5` sets the render scale (canvas backing store per CSS px, reported as device px).
 * Also `window.__seuratRender` for console use.
 */
export interface RenderFlags {
  grid: boolean;
  shadow: boolean;
  dots: boolean;
  cull: boolean;
  lod: boolean;
  blurWhileMoving: boolean;
  fps: boolean;
  /** WebGL2 renderer (spec §5.1 texture arrays); Canvas2D when off or unavailable. */
  gpu: boolean;
  /** Backing-store scale: `auto` caps the canvas at RENDER_MAX_BACKING_PX, or a fixed step. */
  scale: RenderScaleSetting;
}

/** The on/off switches: every flag but the scale. */
export type BooleanFlag = { [K in keyof RenderFlags]: RenderFlags[K] extends boolean ? K : never }[keyof RenderFlags];

export const DEFAULT_RENDER_FLAGS: Readonly<RenderFlags> = {
  grid: true, shadow: true, dots: true, cull: true, lod: true, blurWhileMoving: false, fps: false, gpu: true, scale: 'auto',
};

const STORAGE_KEY = 'seurat.render';

/** `base` overridden by the switches named in `?render=` (unknown switches are ignored). */
export function parseRenderFlags(search: string, base: Readonly<RenderFlags> = DEFAULT_RENDER_FLAGS): RenderFlags {
  const raw = new URLSearchParams(search).get('render') ?? '';
  const on = new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  const out = { ...base };
  if (on.has('nogrid')) out.grid = false;
  if (on.has('noshadow')) out.shadow = false;
  if (on.has('nodots')) out.dots = false;
  if (on.has('nocull')) out.cull = false;
  if (on.has('nolod')) out.lod = false;
  if (on.has('blur')) out.blurWhileMoving = true;
  if (on.has('fps')) out.fps = true;
  if (on.has('gpu')) out.gpu = true;
  if (on.has('nogpu')) out.gpu = false;
  for (const t of on) {
    const v = t.startsWith('scale:') ? parseRenderScale(t.slice('scale:'.length)) : null;
    if (v !== null) out.scale = v;
  }
  return out;
}

function stored(): Partial<RenderFlags> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof v === 'object' && v !== null ? (v as Partial<RenderFlags>) : {};
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    const diff: Partial<RenderFlags> = {};
    for (const k of Object.keys(DEFAULT_RENDER_FLAGS) as Array<keyof RenderFlags>) {
      if (renderFlags[k] !== DEFAULT_RENDER_FLAGS[k]) Object.assign(diff, { [k]: renderFlags[k] });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // Private mode or blocked storage: the switch still applies for this page.
  }
}

function initial(): RenderFlags {
  if (typeof location === 'undefined') return { ...DEFAULT_RENDER_FLAGS };
  const base = { ...DEFAULT_RENDER_FLAGS };
  for (const [k, v] of Object.entries(stored())) {
    if (k === 'scale') base.scale = parseRenderScale(v) ?? base.scale;
    else if (k in base && typeof v === 'boolean') base[k as BooleanFlag] = v;
  }
  return parseRenderFlags(location.search, base);
}

/** Live flags, read by the renderer every frame (mutated in place, never replaced). */
export const renderFlags: RenderFlags = initial();

let snapshot: RenderFlags = { ...renderFlags };
const listeners = new Set<() => void>();

function changed(): void {
  snapshot = { ...renderFlags };
  persist();
  for (const l of listeners) l();
}

export function setRenderFlag(key: BooleanFlag, value: boolean): void {
  if (renderFlags[key] === value) return;
  renderFlags[key] = value;
  changed();
}

export function setRenderScale(value: RenderScaleSetting): void {
  if (renderFlags.scale === value) return;
  renderFlags.scale = value;
  changed();
}

export function resetRenderFlags(): void {
  Object.assign(renderFlags, DEFAULT_RENDER_FLAGS);
  changed();
}

export function subscribeRenderFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Immutable snapshot for React; re-renders on every switch change. */
export function useRenderFlags(): RenderFlags {
  return useSyncExternalStore(subscribeRenderFlags, () => snapshot, () => snapshot);
}

if (typeof window !== 'undefined') {
  (window as unknown as { __seuratRender: RenderFlags }).__seuratRender = renderFlags;
}
