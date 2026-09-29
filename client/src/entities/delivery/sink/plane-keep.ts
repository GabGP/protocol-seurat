import { SKETCH_MIN } from '@/shared/config/constants';
import type { DeliveryRecord } from '../store';
import type { SinkState } from './state';

/** The sketch strata (this and coarser) seed every cone: their planes always stay. */
export function sketchStratum(s: SinkState): number {
  return Math.min(SKETCH_MIN, Math.max(0, s.top - 1));
}

/** A child already held or parked on this brush: it needs (or will get redone on) these planes. */
export function hasChildWork(s: SinkState, rec: DeliveryRecord): boolean {
  for (const w of s.pending.values()) if (w.parentId === rec.brushId && w.edition === rec.edition) return true;
  return [...(s.book.childrenOf.get(rec.delivery) ?? [])].some((k) => s.book.byDelivery.has(k));
}

/**
 * Whether a brush keeps its planes as it lands. Its children are planned only above the focus
 * (they arrive at focus + j, spec 2.3), and never below min_estrato (spec 4.1 a). At or below the
 * focus they come only after a zoom-in, which rebuilds one level from bands (`rebuildPlanes`).
 */
export function keepsPlanes(s: SinkState, rec: DeliveryRecord): boolean {
  if (rec.stratum <= (s.grant?.minStratum ?? 0)) return false;
  return !s.view || rec.stratum >= sketchStratum(s) || rec.stratum > s.view.focus || hasChildWork(s, rec);
}
