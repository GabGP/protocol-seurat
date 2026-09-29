import { removeSubtree } from './removal';
import { settle } from './scrape-flow';
import type { SinkState } from './state';

/** PLAN CANCELADAS: these numbers will never arrive (or are dropped if they did), with whatever waited on them. */
export function applyCancelled(s: SinkState, ranges: number[]): void {
  for (const n of ranges) {
    s.cancelled.add(n);
    settle(s, n);
    const brushId = s.book.byDelivery.get(n)?.brushId;
    removeSubtree(s, n, 0, 'cancelled');
    if (brushId === undefined) continue;
    for (const [delivery, item] of s.pending) {
      if (item.parentId === brushId) removeSubtree(s, delivery, 0, 'cancelled');
    }
  }
}
