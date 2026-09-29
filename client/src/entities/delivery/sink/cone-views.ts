import type { EvictView } from '../evict-candidate';
import type { SinkState } from './state';

/** The current view and the past ones whose flows the server may still be painting (`PaintedCones`). */
export function coneViews(s: SinkState): EvictView[] {
  return s.cones.views((n) => s.settlement.settledBelow(n, (m) => s.book.byDelivery.has(m)));
}
