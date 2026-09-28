import type { BrushGeom } from './brush-cull';

/** Per-instance floats: device rect (4), texture uv rect (4), image-px rect relative to the frame origin (4), layer (1). */
export const INSTANCE_FLOATS = 13;

export interface PackView {
  /** Image px → CSS px is `t + x * s`. */
  tx: number;
  ty: number;
  s: number;
  dpr: number;
  /** Clip rect in CSS px (already intersected with the image). */
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  /** Integer image-px origin subtracted from image coords, so shaders see small numbers. */
  ox: number;
  oy: number;
}

/**
 * Packs brushes as clipped quads. All the large-number maths (a 176k-px image at 6400% puts
 * t near 1e7) happens here in double precision; the GPU only interpolates small values inside
 * the view. Edges come from `t + imageX * s` with integer image coordinates, so neighbours
 * share exactly the same float and rasterize watertight.
 */
export function packTiles(list: readonly BrushGeom[], v: PackView, layerOf: (b: BrushGeom) => number,
  out: Float32Array, start = 0): number {
  let n = start;
  for (const b of list) {
    const x0 = v.tx + b.x * v.s;
    const x1 = v.tx + (b.x + b.w) * v.s;
    const y0 = v.ty + b.y * v.s;
    const y1 = v.ty + (b.y + b.h) * v.s;
    const a0 = Math.max(x0, v.cx0);
    const a1 = Math.min(x1, v.cx1);
    const c0 = Math.max(y0, v.cy0);
    const c1 = Math.min(y1, v.cy1);
    if (a1 <= a0 || c1 <= c0) continue;
    const i = n * INSTANCE_FLOATS;
    if (i + INSTANCE_FLOATS > out.length) break;
    out[i] = a0 * v.dpr;
    out[i + 1] = c0 * v.dpr;
    out[i + 2] = a1 * v.dpr;
    out[i + 3] = c1 * v.dpr;
    out[i + 4] = (a0 - x0) / (x1 - x0);
    out[i + 5] = (c0 - y0) / (y1 - y0);
    out[i + 6] = (a1 - x0) / (x1 - x0);
    out[i + 7] = (c1 - y0) / (y1 - y0);
    out[i + 8] = (a0 - v.tx) / v.s - v.ox;
    out[i + 9] = (c0 - v.ty) / v.s - v.oy;
    out[i + 10] = (a1 - v.tx) / v.s - v.ox;
    out[i + 11] = (c1 - v.ty) / v.s - v.oy;
    out[i + 12] = layerOf(b);
    n++;
  }
  return n - start;
}

/**
 * Draw runs for tiles spread over several texture arrays, keeping painter's order coarse → fine:
 * a coarse tile drawn after a finer one would cover it. Tiles of one stratum never overlap, so
 * within a stratum they are grouped by array (stable sort); tiles with no slot are left out.
 */
export function arrayRuns(tiles: readonly BrushGeom[], arrayOf: (b: BrushGeom) => number | undefined):
  Array<{ array: number; tiles: BrushGeom[] }> {
  const slotted = tiles.flatMap((b) => {
    const array = arrayOf(b);
    return array === undefined ? [] : [{ b, array }];
  }).sort((p, q) => q.b.stratum - p.b.stratum || p.array - q.array);
  const runs: Array<{ array: number; tiles: BrushGeom[] }> = [];
  for (const { b, array } of slotted) {
    const last = runs[runs.length - 1];
    if (last?.array === array) last.tiles.push(b);
    else runs.push({ array, tiles: [b] });
  }
  return runs;
}

/** CSS clip of the view ∩ the image, plus the integer image origin for `packTiles`. */
export function clipView(tx: number, ty: number, s: number, iw: number, ih: number,
  cx0: number, cy0: number, cx1: number, cy1: number, dpr: number): PackView | null {
  const x0 = Math.max(cx0, tx);
  const y0 = Math.max(cy0, ty);
  const x1 = Math.min(cx1, tx + iw * s);
  const y1 = Math.min(cy1, ty + ih * s);
  if (x1 <= x0 || y1 <= y0) return null;
  return { tx, ty, s, dpr, cx0: x0, cy0: y0, cx1: x1, cy1: y1,
    ox: Math.floor((x0 - tx) / s), oy: Math.floor((y0 - ty) / s) };
}
