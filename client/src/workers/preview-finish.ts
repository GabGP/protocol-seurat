import { shrinkRegion, type Rect } from './plane-shrink';
import { planesToRgba } from './planes-rgba';

/**
 * Part `out` of a composed level `levelWidth × levelHeight` shown at `width × height`: `planes`
 * are the level's part `src` it reads (transferred, not used again).
 */
export interface FinishRequest {
  id: number;
  planes: ArrayBuffer[];
  src: Rect;
  out: Rect;
  levelWidth: number;
  levelHeight: number;
  width: number;
  height: number;
}

/** The part's opaque RGBA, `out.w × out.h`. */
export interface FinishResult {
  id: number;
  rgba: ArrayBuffer | null;
}

/** The part asked for at the card's size, as RGBA: the thumbnail's last and largest per-pixel step. */
export function finishRegion(req: Omit<FinishRequest, 'id' | 'planes'>, planes: Int16Array[]): Uint8ClampedArray {
  const { src, out, levelWidth, levelHeight, width, height } = req;
  const [Y, Co, Cg] = shrinkRegion(planes, src, levelWidth, levelHeight, width, height, out);
  const px = out.w * out.h;
  const empty = new Int16Array(px);
  return planesToRgba(Y ?? empty, Co ?? empty, Cg ?? empty, px);
}
