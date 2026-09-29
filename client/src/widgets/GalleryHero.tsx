import { useEffect, useRef } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { clamp } from '@/shared/lib/clamp';
import { Icon } from '@/shared/ui/Icon';
import { useWorkPreview } from '@/entities/work';
import { MS_PER_S } from '@/shared/config/units';
import {
  HERO_DOT_R_MIN, HERO_DOT_R_SPAN, HERO_EASE_OVERSHOOT, HERO_GRID_CELL as CELL, HERO_GROW_S, HERO_JITTER,
  HERO_WAVE_JITTER_S, HERO_WAVE_S, TAU,
} from '@/shared/config/render';
import styles from './GalleryHero.module.css';
import { deviceDpr } from '@/shared/lib/dpr';

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
    let dots: Dots = { cols: 0, rows: 0, all: [] };
    function tick(): void {
      cancelAnimationFrame(raf);
      const c = ref.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = deviceDpr();
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
      if (dots.cols !== cols || dots.rows !== rows) dots = layDots(sample, cols, rows);
      const t = (performance.now() - start) / MS_PER_S;
      let busy = false;
      for (const d of dots.all) {
        const p = clamp((t - d.delay) / HERO_GROW_S, 0, 1);
        if (p < 1) busy = true;
        if (p <= 0) continue;
        const q = p - 1;
        const e = 1 + (HERO_EASE_OVERSHOOT + 1) * q * q * q + HERO_EASE_OVERSHOOT * q * q;
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y, Math.max(0, d.r * e), 0, TAU);
        ctx.fill();
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

type Sample = { d: Uint8ClampedArray; w: number; h: number };
type Dots = { cols: number; rows: number; all: { x: number; y: number; r: number; delay: number; color: string }[] };

/** Each dot of a `cols × rows` grid over `sample` (cover-fit): where it sits, its full size and colour, when it grows in. */
function layDots(sample: Sample, cols: number, rows: number): Dots {
  const k = Math.max(cols / sample.w, rows / sample.h);
  const ox = (sample.w * k - cols) / 2;
  const oy = (sample.h * k - rows) / 2;
  const all: Dots['all'] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const [h1, h2, h3] = hash3(x, y);
      const sx = clamp(Math.floor((x + ox) / k), 0, sample.w - 1);
      const sy = clamp(Math.floor((y + oy) / k), 0, sample.h - 1);
      const i = (sy * sample.w + sx) * 4;
      all.push({
        x: (x + 0.5 + (h1 - 0.5) * HERO_JITTER) * CELL,
        y: (y + 0.5 + (h2 - 0.5) * HERO_JITTER) * CELL,
        r: CELL * (HERO_DOT_R_MIN + HERO_DOT_R_SPAN * h3),
        delay: (1 - x / cols) * HERO_WAVE_S + h3 * HERO_WAVE_JITTER_S,
        color: 'rgb(' + sample.d[i] + ',' + sample.d[i + 1] + ',' + sample.d[i + 2] + ')',
      });
    }
  }
  return { cols, rows, all };
}

function makeSample(): Sample {
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
