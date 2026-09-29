import { TILE } from '@/shared/config/constants';
import { SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';

export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * True when the drawn tiles (sketch ignored) leave no hole in `r` (image px, clamped to the
 * image): the sketch under them would be fully overdrawn. A cell counts as covered when it is
 * drawn, or when every child cell touching `r` and the image is covered.
 */
export function tilesCover(tiles: readonly BrushGeom[], r: Region, iw: number, ih: number): boolean {
  const x0 = Math.max(0, r.x0);
  const y0 = Math.max(0, r.y0);
  const x1 = Math.min(iw, r.x1);
  const y1 = Math.min(ih, r.y1);
  if (x1 <= x0 || y1 <= y0) return true;
  const drawn = new Set<string>();
  let top = -1;
  for (const b of tiles) {
    if (b.stratum === SKETCH_STRATUM) continue;
    drawn.add(`${b.stratum}/${b.bx}/${b.by}`);
    top = Math.max(top, b.stratum);
  }
  if (top < 0) return false;
  const span = (s: number, lo: number, hi: number): [number, number] => {
    const side = TILE * 2 ** s;
    return [Math.floor(lo / side), Math.ceil(hi / side) - 1];
  };
  // Every top cell must be a drawn tile or split into drawn ones: more cells than tiles can't be.
  const [ax, bx] = span(top, x0, x1);
  const [ay, by] = span(top, y0, y1);
  if ((bx - ax + 1) * (by - ay + 1) > drawn.size) return false;
  const covered = (s: number, cx: number, cy: number): boolean => {
    if (drawn.has(`${s}/${cx}/${cy}`)) return true;
    if (s === 0) return false;
    const side = TILE * 2 ** (s - 1);
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const kx = 2 * cx + i;
        const ky = 2 * cy + j;
        const lx = kx * side;
        const ly = ky * side;
        if (lx >= x1 || ly >= y1 || lx + side <= x0 || ly + side <= y0) continue; // outside r or image
        if (!covered(s - 1, kx, ky)) return false;
      }
    }
    return true;
  };
  for (let cy = ay; cy <= by; cy++) {
    for (let cx = ax; cx <= bx; cx++) if (!covered(top, cx, cy)) return false;
  }
  return true;
}

/**
 * Device-px snapped [start, length) of the CSS span a0..a1. Callers compute every edge as
 * `t + imageX * s` from the integer image coordinate, so a tile's right edge and its neighbour's
 * left edge are the same float, round the same way, and the tiles abut with no gap or overlap.
 */
export function snapSpan(a0: number, a1: number, dpr: number): [number, number] {
  const s0 = Math.round(a0 * dpr);
  const s1 = Math.round(a1 * dpr);
  return [s0 / dpr, (s1 - s0) / dpr];
}
