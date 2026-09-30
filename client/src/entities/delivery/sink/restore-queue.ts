import { PIXEL_RESTORE_WINDOW } from '@/shared/config/memory';
import { parentBrushId, splitBrushId } from '@/shared/proto/brush';
import type { DeliveryRecord } from '../store';
import { parentFor } from './brush-graph';
import { rebuildPlanes } from './rebuild-planes';
import { enqueue } from './synth-dispatch';
import { buildRequest, distTiles, withParent } from './synth-request';
import type { SinkState } from './state';

/**
 * The local rebuilds of released bitmaps: a queue (`wanted`, deduped) and a window (`restoring`),
 * so a context restore does not flood the workers or the decode queue (each request also carries
 * a copy of its parent's planes).
 */

/** A drawable brush lost its pixels: queue one local rebuild (deduped, windowed). */
export function wantPixels(s: SinkState, delivery: number): void {
  const rec = s.book.byDelivery.get(delivery);
  if (!rec || rec.rgba || !rec.image || rec.pending || !rec.bands?.length) return;
  if (s.wanted.has(delivery) || s.restoring.has(delivery) || s.rebuilding.has(delivery) || s.pending.has(delivery)) return;
  s.wanted.add(delivery);
  pumpRestores(s);
}

/** A local restore ended without an image (or with another owner): free its window slot. */
export function endRestore(s: SinkState, delivery: number): void {
  s.restoring.delete(delivery);
  s.wanted.delete(delivery);
  pumpRestores(s);
}

/** Coarse first (children come from them), then nearest the focus. */
function next(s: SinkState): DeliveryRecord | null {
  let best: DeliveryRecord | null = null;
  let bestDist = Infinity;
  for (const d of [...s.wanted]) {
    const rec = s.book.byDelivery.get(d);
    if (!rec || rec.rgba) {
      s.wanted.delete(d);
      continue;
    }
    const dist = distTiles(s, rec.brushId);
    if (!best || rec.stratum > best.stratum || (rec.stratum === best.stratum && dist < bestDist)) {
      best = rec;
      bestDist = dist;
    }
  }
  return best;
}

/** Keeps at most PIXEL_RESTORE_WINDOW rebuilds running. */
export function pumpRestores(s: SinkState): void {
  while (s.restoring.size < PIXEL_RESTORE_WINDOW) {
    const rec = next(s);
    if (!rec) return;
    s.wanted.delete(rec.delivery);
    startRestore(s, rec);
  }
}

function startRestore(s: SinkState, rec: DeliveryRecord): void {
  const { stratum, bx, by } = splitBrushId(rec.brushId);
  const parent = parentFor(s.book, s.top, stratum, bx, by, rec.edition, rec.epoch);
  if (!parent) return; // ancestors gone: the brush is not drawable from them either
  s.restoring.add(rec.delivery);
  const req = { ...buildRequest(s, rec, rec.qY ?? 0, rec.qC ?? 0), restore: true };
  if (parent.planes) {
    withParent(s, req, parent, bx, by);
    enqueue(s, req, rec.brushId, rec.epoch);
    return;
  }
  s.pending.set(rec.delivery, { req, parentId: parentBrushId(stratum, bx, by, s.top), edition: rec.edition });
  rebuildPlanes(s, parent);
}
