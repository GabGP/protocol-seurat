import { useEffect, useRef } from 'react';
import { clamp } from '@/shared/lib/clamp';
import { splitBrushId } from '@/shared/proto/brush';
import type { DeliverySink } from '@/app/providers/delivery-sink';
import type { ChromeApi, ViewSync } from './ViewerChrome';

import { MINIMAP_MAX_H, MINIMAP_MAX_W } from '@/shared/config/layout';
import styles from './ViewerMinimap.module.css';

interface Props {
  api: { current: ChromeApi | null };
  view: ViewSync | null;
  iw: number;
  ih: number;
  ready: boolean;
  sink?: DeliverySink | null;
  paintTick?: number;
}

export function ViewerMinimap({ api, view, iw, ih, ready, sink, paintTick }: Props): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const m = ref.current;
    if (!m || !view) return;
    const k = Math.min(MINIMAP_MAX_W / iw, MINIMAP_MAX_H / ih);
    const w = Math.max(8, Math.round(iw * k));
    const h = Math.max(8, Math.round(ih * k));
    const dpr = window.devicePixelRatio || 1;
    if (m.width !== Math.round(w * dpr) || m.height !== Math.round(h * dpr)) {
      m.width = Math.round(w * dpr);
      m.height = Math.round(h * dpr);
      m.style.width = w + 'px';
      m.style.height = h + 'px';
    }
    const c = m.getContext('2d');
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#23242B';
    c.fillRect(0, 0, w, h);

    let hasThumb = false;
    if (sink) {
      const brushes = [...sink.book.byDelivery.values()]
        .filter((r) => r.rgba !== null && (r.rgba as { closed?: boolean }).closed !== true)
        .sort((a, b) => b.stratum - a.stratum);
      if (brushes.length > 0) {
        hasThumb = true;
        for (const rec of brushes) {
          if (!rec.rgba) continue;
          const { stratum, bx, by } = splitBrushId(rec.brushId);
          if (stratum === 10) {
            c.drawImage(rec.rgba, 0, 0, iw * k, ih * k);
          } else {
            const size = 256 * 2 ** stratum;
            c.drawImage(rec.rgba, bx * size * k, by * size * k, size * k, size * k);
          }
        }
      }
    }

    if (!hasThumb) {
      c.fillStyle = 'rgba(197,198,208,0.25)';
      for (let y = 4; y < h; y += 8) {
        for (let x = 4; x < w; x += 8) {
          c.fillRect(x, y, 1.5, 1.5);
        }
      }
    }

    let x0 = (-view.tx / view.s) * k;
    let y0 = (-view.ty / view.s) * k;
    const x1 = x0 + (view.w / view.s) * k;
    const y1 = y0 + (view.h / view.s) * k;
    x0 = clamp(x0, 0, w);
    y0 = clamp(y0, 0, h);
    const cx1 = clamp(x1, 0, w);
    const cy1 = clamp(y1, 0, h);
    const isFull = x0 <= 0.5 && y0 <= 0.5 && cx1 >= w - 0.5 && cy1 >= h - 0.5;

    if (!isFull) {
      c.fillStyle = 'rgba(13,14,19,0.6)';
      c.beginPath();
      c.rect(0, 0, w, h);
      c.rect(x0, y0, cx1 - x0, cy1 - y0);
      c.fill('evenodd');
    }

    const rx = isFull ? 0.5 : x0;
    const ry = isFull ? 0.5 : y0;
    const rw = isFull ? w - 1 : Math.max(4, cx1 - x0);
    const rh = isFull ? h - 1 : Math.max(4, cy1 - y0);
    c.strokeStyle = '#B8C4FF';
    c.lineWidth = 2;
    c.beginPath();
    if (c.roundRect) c.roundRect(rx, ry, rw, rh, 3);
    else c.rect(rx, ry, rw, rh);
    c.stroke();
  }, [view, iw, ih, sink, paintTick]);

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
