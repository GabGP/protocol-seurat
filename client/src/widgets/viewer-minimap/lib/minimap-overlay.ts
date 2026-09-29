import { clamp } from '@/shared/lib/clamp';
import type { ViewRect } from '@/entities/viewport';
import {
  ACCENT_COLOR, MINIMAP_BOX_RADIUS, MINIMAP_BOX_WIDTH, MINIMAP_FULL_TOLERANCE, MINIMAP_MIN_BOX, MINIMAP_SHADE_COLOR,
} from '@/shared/config/render';
import type { Size } from './minimap-thumb';

/** Cached thumbnail + the viewport box on top: the box follows every frame, the thumbnail does not. */
export function drawOverlay(c: CanvasRenderingContext2D, thumb: HTMLCanvasElement | null, view: ViewRect | null, z: Size): void {
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
