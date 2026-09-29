import { FRAME_SHADOW_BLUR, SHADOW_REACH_PER_BLUR } from '@/shared/config/render';

/** [sx, sy, sw, sh, dx, dy, dw, dh] in CSS px; source coords are sprite-local. */
export type Slice = [number, number, number, number, number, number, number, number];

/** Reach of a shadow sprite around its shape (CSS px). */
export const FRAME_REACH = Math.ceil(FRAME_SHADOW_BLUR * SHADOW_REACH_PER_BLUR);
/** Sprite side: two corners (reach outside + reach inside the edge) + a 2px stretchable middle. */
export const FRAME_SPRITE = 4 * FRAME_REACH + 2;

/**
 * 9-slice of the frame shadow around rect (x,y,w,h), minus the centre (the frame's own black
 * fill covers it). Needs w,h >= 2·reach; smaller rects are cheap to blur directly.
 */
export function frameShadowSlices(x: number, y: number, w: number, h: number, reach = FRAME_REACH): Slice[] | null {
  if (w < 2 * reach || h < 2 * reach) return null;
  const c = 2 * reach;
  const src = [0, c, c + 2];
  const srcLen = [c, 2, c];
  const dst = (o: number, len: number): number[] => [o - reach, o + reach, o + len - reach];
  const dstLen = (len: number): number[] => [c, len - c, c];
  const dx = dst(x, w);
  const dy = dst(y, h);
  const dw = dstLen(w);
  const dh = dstLen(h);
  const at = (a: number[], i: number): number => a[i] ?? 0;
  const out: Slice[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue;
      out.push([at(src, i), at(src, j), at(srcLen, i), at(srcLen, j), at(dx, i), at(dy, j), at(dw, i), at(dh, j)]);
    }
  }
  return out;
}

/**
 * Up to four bands covering [0,W]×[0,H] minus `hole`, which is shrunk by 1px so the bands run
 * under the image's antialiased edge (the image is drawn after them).
 */
export function aroundHole(W: number, H: number, hole: { x0: number; y0: number; x1: number; y1: number } | null):
  Array<[number, number, number, number]> {
  if (!hole) return [[0, 0, W, H]];
  const x0 = Math.max(0, Math.ceil(hole.x0) + 1);
  const y0 = Math.max(0, Math.ceil(hole.y0) + 1);
  const x1 = Math.min(W, Math.floor(hole.x1) - 1);
  const y1 = Math.min(H, Math.floor(hole.y1) - 1);
  if (x1 <= x0 || y1 <= y0) return [[0, 0, W, H]];
  const out: Array<[number, number, number, number]> = [];
  if (y0 > 0) out.push([0, 0, W, y0]);
  if (y1 < H) out.push([0, y1, W, H - y1]);
  if (x0 > 0) out.push([0, y0, x0, y1 - y0]);
  if (x1 < W) out.push([x1, y0, W - x1, y1 - y0]);
  return out;
}
