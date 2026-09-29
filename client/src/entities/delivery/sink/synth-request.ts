import { SEED_STRATUM, TILE } from '@/shared/config/constants';
import { brushKey, splitBrushId } from '@/shared/proto/brush';
import type { SynthRequest } from '@/workers/protocol';
import type { DeliveryRecord } from '../store';
import { brushBands } from './brush-graph';
import type { SinkState } from './state';

/** A first-pass synthesis request for one held delivery, its bands gathered from every delivery of the brush. */
export function buildRequest(s: SinkState, rec: DeliveryRecord, qY: number, qC: number): SynthRequest {
  const { stratum } = splitBrushId(rec.brushId);
  return {
    delivery: rec.delivery,
    synthesisId: s.nextSynthesisId++,
    stratum,
    qY,
    qC,
    seed: stratum === SEED_STRATUM,
    seedWidth: s.seedWidth,
    seedHeight: s.seedHeight,
    brush: brushKey(rec.brushId, rec.edition),
    edition: rec.edition,
    bands: brushBands(s.book, rec),
  };
}

/** Attach the parent's planes and the crop that maps them onto this child (the sketch is not a tile grid). */
export function withParent(s: SinkState, req: SynthRequest, parent: DeliveryRecord, bx: number, by: number): void {
  const seed = parent.stratum === SEED_STRATUM;
  const half = TILE / 2;
  req.parentKey = brushKey(parent.brushId, parent.edition);
  req.parentPlanes = (parent.planes ?? []).map((plane) => plane.slice(0));
  req.parentPlaneWidth = seed ? s.seedWidth : TILE;
  req.parentPlaneHeight = seed ? s.seedHeight : TILE;
  req.parentX = seed ? bx * half : (bx & 1) * half;
  req.parentY = seed ? by * half : (by & 1) * half;
}

/** Focus distance in tiles: nearer brushes paint first. */
export function distTiles(s: SinkState, brushId: bigint): number {
  const v = s.view;
  if (!v) return 0;
  const { stratum, bx, by } = splitBrushId(brushId);
  const side = TILE * 2 ** stratum;
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  return Math.floor(Math.hypot(bx * side + side / 2 - cx, by * side + side / 2 - cy) / TILE);
}
