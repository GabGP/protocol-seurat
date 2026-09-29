import { useEffect, useRef } from 'react';
import { clamp } from '@/shared/lib/clamp';
import type { Feed } from '@/shared/lib/feed';
import { useRenderFlags, type RenderFlags } from '@/shared/lib/render-flags';
import type { DeliverySink } from '@/entities/delivery';
import { collectBrushes, cullBrushes } from './brush-cull';
import type { ChromeApi, ViewRect } from './ViewerChrome';

import { MINIMAP_MAX_H, MINIMAP_MAX_W, MINIMAP_THUMB_MS } from '@/shared/config/layout';
import styles from './ViewerMinimap.module.css';
import { deviceDpr } from '@/shared/lib/dpr';
import {
  ACCENT_COLOR, MINIMAP_BG_COLOR, MINIMAP_BOX_RADIUS, MINIMAP_BOX_WIDTH, MINIMAP_DOT_COLOR, MINIMAP_DOT_SIZE,
  MINIMAP_DOT_STEP, MINIMAP_FULL_TOLERANCE, MINIMAP_MIN_BOX, MINIMAP_SHADE_COLOR,
} from '@/shared/config/render';

interface Props {
  api: { current: ChromeApi | null };
  feed: Feed<ViewRect | null>;
  iw: number;
  ih: number;
  ready: boolean;
  sink?: DeliverySink | null;
  paintTick?: number;
}

interface Size {
  k: number;
  w: number;
  h: number;
  dpr: number;
}

function sizeOf(iw: number, ih: number): Size {
  const k = Math.min(MINIMAP_MAX_W / iw, MINIMAP_MAX_H / ih);
  return {
    k,
    w: Math.max(8, Math.round(iw * k)),
    h: Math.max(8, Math.round(ih * k)),
    dpr: deviceDpr(),
  };
}

/** The painted image at minimap scale (sub-pixel tiles culled), or the dotted placeholder. */
function buildThumb(sink: DeliverySink | null | undefined, iw: number, ih: number, z: Size,
  flags: Pick<RenderFlags, 'cull' | 'lod'>): HTMLCanvasElement {
  const t = document.createElement('canvas');
  t.width = Math.round(z.w * z.dpr);
  t.height = Math.round(z.h * z.dpr);
  const c = t.getContext('2d');
  if (!c) return t;
  c.setTransform(z.dpr, 0, 0, z.dpr, 0, 0);
  c.fillStyle = MINIMAP_BG_COLOR;
  c.fillRect(0, 0, z.w, z.h);
  const all = sink ? collectBrushes(sink.book.byDelivery.values(), iw, ih) : [];
  const list = flags.cull ? cullBrushes(all, z.k * z.dpr, iw, ih, flags.lod) : all;
  for (const b of list) c.drawImage(b.bmp, b.x * z.k, b.y * z.k, b.w * z.k, b.h * z.k);
  if (list.length === 0) {
    c.fillStyle = MINIMAP_DOT_COLOR;
    const from = MINIMAP_DOT_STEP / 2;
    for (let y = from; y < z.h; y += MINIMAP_DOT_STEP) {
      for (let x = from; x < z.w; x += MINIMAP_DOT_STEP) c.fillRect(x, y, MINIMAP_DOT_SIZE, MINIMAP_DOT_SIZE);
    }
  }
  return t;
}

/** Cached thumbnail + the viewport box on top: the box follows every frame, the thumbnail does not. */
function drawOverlay(c: CanvasRenderingContext2D, thumb: HTMLCanvasElement | null, view: ViewRect | null, z: Size): void {
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (thumb) c.drawImage(thumb, 0, 0);
  c.setTransform(z.dpr, 0, 0, z.dpr, 0, 0);
  if (!view) return;
  const { k, w, h } = z;
  const x0 = clamp((-view.tx / view.s) * k, 0, w);
  const y0 = clamp((-view.ty / view.s) * k, 0, h);
  const cx1 = clamp(x0 + (view.w / view.s) * k, 0, w);
  const cy1 = clamp(y0 + (view.h / view.s) * k, 0, h);
  const tol = MINIMAP_FULL_TOLERANCE;
  const isFull = x0 <= tol && y0 <= tol && cx1 >= w - tol && cy1 >= h - tol;

  if (!isFull) {
    c.fillStyle = MINIMAP_SHADE_COLOR;
    c.beginPath();
    c.rect(0, 0, w, h);
    c.rect(x0, y0, cx1 - x0, cy1 - y0);
    c.fill('evenodd');
  }

  const rx = isFull ? tol : x0;
  const ry = isFull ? tol : y0;
  const rw = isFull ? w - 2 * tol : Math.max(MINIMAP_MIN_BOX, cx1 - x0);
  const rh = isFull ? h - 2 * tol : Math.max(MINIMAP_MIN_BOX, cy1 - y0);
  c.strokeStyle = ACCENT_COLOR;
  c.lineWidth = MINIMAP_BOX_WIDTH;
  c.beginPath();
  if (c.roundRect) c.roundRect(rx, ry, rw, rh, MINIMAP_BOX_RADIUS);
  else c.rect(rx, ry, rw, rh);
  c.stroke();
}

export function ViewerMinimap({ api, feed, iw, ih, ready, sink, paintTick }: Props): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);
  const thumb = useRef<HTMLCanvasElement | null>(null);
  const builtAt = useRef(-Infinity);
  const repaint = useRef<() => void>(() => undefined);
  const { cull, lod } = useRenderFlags();

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    const z = sizeOf(iw, ih);
    if (m.width !== Math.round(z.w * z.dpr) || m.height !== Math.round(z.h * z.dpr)) {
      m.width = Math.round(z.w * z.dpr);
      m.height = Math.round(z.h * z.dpr);
      m.style.width = z.w + 'px';
      m.style.height = z.h + 'px';
    }
    const c = m.getContext('2d');
    if (!c) return;
    const draw = (): void => drawOverlay(c, thumb.current, feed.get(), z);
    repaint.current = draw;
    draw();
    const off = feed.subscribe(draw);
    return () => {
      off();
      repaint.current = () => undefined;
    };
  }, [feed, iw, ih, ready]);

  useEffect(() => {
    if (!ready) return;
    const build = (): void => {
      builtAt.current = performance.now();
      thumb.current = buildThumb(sink, iw, ih, sizeOf(iw, ih), { cull, lod });
      repaint.current();
    };
    const wait = builtAt.current + MINIMAP_THUMB_MS - performance.now();
    if (wait <= 0) {
      build();
      return;
    }
    const timer = window.setTimeout(build, wait); // trailing edge: the last paint always lands
    return () => window.clearTimeout(timer);
  }, [sink, paintTick, iw, ih, ready, cull, lod]);

  if (!ready) return null;

  const pan = (clientX: number, clientY: number): void => {
    const m = ref.current;
    if (!m) return;
    const r = m.getBoundingClientRect();
    const k = Math.min(MINIMAP_MAX_W / iw, MINIMAP_MAX_H / ih);
    api.current?.panTo((clientX - r.left) / k, (clientY - r.top) / k);
  };

  return (
    <div className={styles.panel}>
      <canvas
        ref={ref}
        onPointerDown={(e) => {
          drag.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pan(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (drag.current) pan(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          drag.current = false;
        }}
        onPointerCancel={() => {
          drag.current = false;
        }}
        className={styles.canvas}
      />
    </div>
  );
}
