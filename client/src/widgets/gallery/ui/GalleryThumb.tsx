import { useEffect, useRef } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { notePreviewWidth, previewDpr, useWorkPreview } from '@/entities/work';
import type { Work, WorkPreview } from '@/entities/work';
import { drawScaledRgba } from '@/shared/codec/seed';
import { GALLERY_PLACEHOLDER_MIN_PX, GALLERY_PLACEHOLDER_PX } from '@/shared/config/layout';
import { deviceDpr } from '@/shared/lib/dpr';
import styles from './GalleryGrid.module.css';

/** Noise placeholder, drawn small and stretched until the work's seed arrives. */
function drawPlaceholder(c: HTMLCanvasElement, work: Work): void {
  const ar = work.height > 0 ? work.width / work.height : 1;
  const max = GALLERY_PLACEHOLDER_PX;
  const w = ar >= 1 ? max : Math.max(GALLERY_PLACEHOLDER_MIN_PX, Math.round(max * ar));
  const h = ar >= 1 ? Math.max(GALLERY_PLACEHOLDER_MIN_PX, Math.round(max / ar)) : max;
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  let seed = 0;
  for (const ch of work.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [a, b, cc] = hash3(x + seed, y - seed);
      const i = (y * w + x) * 4;
      img.data[i] = Math.round(90 + 120 * a);
      img.data[i + 1] = Math.round(100 + 100 * b);
      img.data[i + 2] = Math.round(170 + 70 * cc);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function Thumb({ work }: { work: Work }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  /** The preview the canvas shows: a finer one is drawn even when the card keeps its size. */
  const shown = useRef<WorkPreview>();
  const preview = useWorkPreview(work.id);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    notePreviewWidth(Math.round(c.clientWidth * previewDpr()));
    if (!preview) {
      shown.current = undefined;
      drawPlaceholder(c, work);
      return;
    }
    // One resample from the preview straight to device pixels: the browser does not stretch it again.
    const draw = (): void => {
      const dpr = deviceDpr(); // client size: the card's press scale is not a resize
      const w = Math.round(c.clientWidth * dpr) || preview.width;
      const h = Math.round(c.clientHeight * dpr) || preview.height;
      if (c.width === w && c.height === h && shown.current === preview) return;
      shown.current = preview;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) drawScaledRgba(ctx, preview.rgba, preview.width, preview.height, w, h);
    };
    draw();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [work, preview]);

  return <canvas ref={ref} className={styles.thumbCanvas} />;
}
