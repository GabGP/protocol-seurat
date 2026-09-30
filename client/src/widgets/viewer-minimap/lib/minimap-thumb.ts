import type { RenderFlags } from '@/shared/lib/render-flags';
import { deviceDpr } from '@/shared/lib/dpr';
import { collectBrushes, cullBrushes, type DeliverySink } from '@/entities/delivery';
import { MINIMAP_MAX_H, MINIMAP_MAX_W, MINIMAP_MIN_PX } from '@/shared/config/layout';
import { MINIMAP_BG_COLOR, MINIMAP_DOT_COLOR, MINIMAP_DOT_SIZE, MINIMAP_DOT_STEP } from '@/shared/config/render';

export interface Size {
  k: number;
  w: number;
  h: number;
  dpr: number;
}

/** Image px to minimap CSS px. */
export function minimapScale(iw: number, ih: number): number {
  return Math.min(MINIMAP_MAX_W / iw, MINIMAP_MAX_H / ih);
}

export function sizeOf(iw: number, ih: number): Size {
  const k = minimapScale(iw, ih);
  return {
    k,
    w: Math.max(MINIMAP_MIN_PX, Math.round(iw * k)),
    h: Math.max(MINIMAP_MIN_PX, Math.round(ih * k)),
    dpr: deviceDpr(),
  };
}

/** The painted image at minimap scale (sub-pixel tiles culled), or the dotted placeholder. */
export function buildThumb(sink: DeliverySink | null | undefined, iw: number, ih: number, z: Size,
  flags: Pick<RenderFlags, 'cull' | 'lod'>): HTMLCanvasElement {
  const t = document.createElement('canvas');
  t.width = Math.round(z.w * z.dpr);
  t.height = Math.round(z.h * z.dpr);
  const c = t.getContext('2d');
  if (!c) return t;
  c.setTransform(z.dpr, 0, 0, z.dpr, 0, 0);
  c.fillStyle = MINIMAP_BG_COLOR;
  c.fillRect(0, 0, z.w, z.h);
  // Tiles the GPU holds have released their bitmap: the seed's sketch (never released) and the rest still held make the thumb.
  const all = sink ? collectBrushes(sink.book.byDelivery.values(), iw, ih).filter((b) => b.bmp) : [];
  const list = flags.cull ? cullBrushes(all, z.k * z.dpr, iw, ih, flags.lod) : all;
  for (const b of list) if (b.bmp) c.drawImage(b.bmp, b.x * z.k, b.y * z.k, b.w * z.k, b.h * z.k);
  if (list.length === 0) {
    c.fillStyle = MINIMAP_DOT_COLOR;
    const from = MINIMAP_DOT_STEP / 2;
    for (let y = from; y < z.h; y += MINIMAP_DOT_STEP) {
      for (let x = from; x < z.w; x += MINIMAP_DOT_STEP) c.fillRect(x, y, MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE);
    }
  }
  return t;
}

