import { useEffect, useRef } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { clamp } from '@/shared/lib/clamp';
import { Icon } from '@/shared/ui/Icon';
import { useWorkPreview } from '@/entities/work';
import { HERO_GRID_CELL as CELL, TAU } from '@/shared/config/render';
import styles from './GalleryHero.module.css';

export function GalleryHero({
  onOpen,
  featuredWorkId,
  featuredTitle = 'Plate 01',
}: {
  onOpen: () => void;
  featuredWorkId?: string;
  featuredTitle?: string;
}): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useWorkPreview(featuredWorkId ?? '');
  // The dots grow in once: a sharper preview repaints them in place rather than replaying the intro.
  const born = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let raf = 0;
    const ro = new ResizeObserver(() => tick());
    ro.observe(canvas);
    born.current ||= performance.now();
    const start = born.current;
    const sample = preview
      ? { d: preview.rgba, w: preview.width, h: preview.height }
      : makeSample();
    function tick(): void {
      cancelAnimationFrame(raf);
      const c = ref.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(r.width * dpr);
      const H = Math.round(r.height * dpr);
      if (W === 0 || H === 0) return;
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, r.width, r.height);
      const cols = Math.ceil(r.width / CELL) + 1;
      const rows = Math.ceil(r.height / CELL) + 1;
      const k = Math.max(cols / sample.w, rows / sample.h);
      const ox = (sample.w * k - cols) / 2;
      const oy = (sample.h * k - rows) / 2;
      const t = (performance.now() - start) / 1000;
      let busy = false;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const [h1, h2, h3] = hash3(x, y);
          const p = clamp((t - (1 - x / cols) * 0.7 - h3 * 0.45) / 0.55, 0, 1);
          if (p < 1) busy = true;
          if (p <= 0) continue;
          const q = p - 1;
          const e = 1 + 2.70158 * q * q * q + 1.70158 * q * q;
          const sx = clamp(Math.floor((x + ox) / k), 0, sample.w - 1);
          const sy = clamp(Math.floor((y + oy) / k), 0, sample.h - 1);
          const i = (sy * sample.w + sx) * 4;
          ctx.fillStyle = 'rgb(' + sample.d[i] + ',' + sample.d[i + 1] + ',' + sample.d[i + 2] + ')';
          ctx.beginPath();
          ctx.arc(
            (x + 0.5 + (h1 - 0.5) * 0.35) * CELL,
            (y + 0.5 + (h2 - 0.5) * 0.35) * CELL,
            Math.max(0, CELL * (0.26 + 0.2 * h3) * e),
            0, TAU,
          );
          ctx.fill();
        }
      }
      if (busy) raf = requestAnimationFrame(tick);
    }
    tick();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [preview]);

  return (
    <section onClick={onOpen} className={styles.heroCard}>
      <canvas ref={ref} className={styles.canvas} />
      <div className={styles.content}>
        <span className={styles.badge}>
          <Icon name="blur_on" size={20} />Deep zoom viewer
        </span>
        <h1 className={styles.title}>Look closer.</h1>
        <p className={styles.description}>Built for massive images. Scroll to zoom, drag to pan — keep zooming in and every pixel becomes a dot.</p>
        <button className={`hero-btn ${styles.heroBtn}`} title={`Open ${featuredTitle}`}>
          <span className={styles.heroBtnText}>Open {featuredTitle}</span>
          <Icon name="arrow_forward" size={22} />
        </button>
      </div>
      <span className={styles.captionChip} title={`${featuredTitle} · one dot per sampled pixel`}>
        {featuredTitle} · one dot per sampled pixel
      </span>
    </section>
  );
}

function makeSample(): { d: Uint8ClampedArray; w: number; h: number } {
  const w = 240;
  const h = 160;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.round(120 + 90 * Math.sin(x / 18) * Math.cos(y / 22));
      d[i + 1] = Math.round(130 + 70 * Math.sin((x + y) / 26));
      d[i + 2] = Math.round(200 + 40 * Math.cos(x / 14 - y / 30));
      d[i + 3] = 255;
    }
  }
  return { d, w, h };
}
