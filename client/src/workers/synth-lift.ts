import { liftBlock, spPredict } from '@/shared/codec/spInverse';
import { TILE, TILE_HALF } from '@/shared/config/protocol';
import { PLANE_CHANNELS, type PlaneSet } from './synth-cache';
import type { BandDetails } from './synth-decode';

/** Inverse S-transform of the parent planes with the decoded details, into the 256x256 child planes. */
export function liftPlanes(parent: PlaneSet, details: BandDetails, planes: PlaneSet): void {
  const last = TILE_HALF - 1;
  for (let c = 0; c < PLANE_CHANNELS.length; c++) {
    const name = PLANE_CHANNELS[c];
    const cd = details[c];
    if (!name || !cd) continue;
    const pl = planes[name];
    const p = parent[name];
    for (let py = 0; py < TILE_HALF; py++) {
      const yPrev = py === 0 ? 0 : -TILE_HALF;
      const yNext = py === last ? 0 : TILE_HALF;
      for (let px = 0; px < TILE_HALF; px++) {
        const xPrev = px === 0 ? 0 : -1;
        const xNext = px === last ? 0 : 1;
        const idx = py * TILE_HALF + px;
        const hHat = spPredict(p[idx + xPrev] ?? 0, p[idx + xNext] ?? 0);
        const vHat = spPredict(p[idx + yPrev] ?? 0, p[idx + yNext] ?? 0);
        const row0 = 2 * py * TILE + 2 * px;
        liftBlock(pl, row0, row0 + TILE, p[idx] ?? 0, (cd.h[idx] ?? 0) + hHat, (cd.v[idx] ?? 0) + vHat, cd.d[idx] ?? 0);
      }
    }
  }
}
