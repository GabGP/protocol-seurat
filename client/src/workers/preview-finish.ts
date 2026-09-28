import { shrinkTo, type Planes } from './plane-shrink';
import { planesToRgba } from './planes-rgba';

/** A composed level to show `width` samples wide: its planes are transferred and not used again. */
export interface FinishRequest {
  id: number;
  planes: ArrayBuffer[];
  width: number;
  height: number;
  shownWidth: number;
}

/** The thumbnail's opaque RGBA, `width × height`. */
export interface FinishResult {
  id: number;
  rgba: ArrayBuffer | null;
  width: number;
  height: number;
}

/** The level at the card's width, as RGBA: the thumbnail's last and largest per-pixel step. */
export function finishPlanes(level: Planes, shownWidth: number): { rgba: Uint8ClampedArray; width: number; height: number } {
  const shown = shrinkTo(level, shownWidth);
  const [Y, Co, Cg] = shown.planes;
  const px = shown.width * shown.height;
  const empty = new Int16Array(px);
  return { rgba: planesToRgba(Y ?? empty, Co ?? empty, Cg ?? empty, px), width: shown.width, height: shown.height };
}
