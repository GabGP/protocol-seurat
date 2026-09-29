import { useEffect, useRef } from 'react';
import type { Feed } from '@/shared/lib/feed';
import { useRenderFlags } from '@/shared/lib/render-flags';
import type { DeliverySink } from '@/entities/delivery';
import type { ChromeApi, ViewRect } from '@/entities/viewport';
import { MINIMAP_THUMB_MS } from '@/shared/config/layout';
import { buildThumb, minimapScale, sizeOf } from '../lib/minimap-thumb';
import { drawOverlay } from '../lib/minimap-overlay';
import styles from './ViewerMinimap.module.css';

interface Props {
  api: { current: ChromeApi | null };
  feed: Feed<ViewRect | null>;
  iw: number;
  ih: number;
  ready: boolean;
  sink?: DeliverySink | null;
  paintTick?: number;
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
    const k = minimapScale(iw, ih);
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
