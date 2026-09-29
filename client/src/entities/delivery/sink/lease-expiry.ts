import { RELEASE_BATCH_MS, ReleaseReason } from '@/shared/config/constants';
import { effectiveExpiry, type DeliveryRecord } from '../store';
import { release } from './release';
import { removeSubtree } from './removal';
import type { SinkState } from './state';

/** A lease ends with its parent's: a child never outlives what it hangs on. */
function leaseEnd(s: SinkState, rec: DeliveryRecord): number {
  const parentId = s.book.parentOf.get(rec.delivery);
  const parent = parentId === undefined ? null : s.book.byDelivery.get(parentId);
  return effectiveExpiry(rec, parent ? leaseEnd(s, parent) : null);
}

/**
 * Spec 5.2.2, before each paint and with each incoming message (never on a timer): nothing
 * expired is painted. Free until the earliest lease in the book ends.
 */
export function checkExpiry(s: SinkState, now: number): void {
  if (now >= s.nextExpiry) sweepExpiry(s, () => now);
}

export function sweepExpiry(s: SinkState, now: () => number): void {
  const t = now();
  const expired = [...s.book.byDelivery.entries()].filter(([, rec]) => leaseEnd(s, rec) <= t).map(([n]) => n);
  for (const n of expired) {
    if (!s.book.byDelivery.has(n)) continue;
    s.expiredQueue.push(...removeSubtree(s, n, 0, 'expired'));
  }
  s.nextExpiry = Infinity; // min over the book of vence = min of vence_efectivo
  for (const rec of s.book.byDelivery.values()) s.nextExpiry = Math.min(s.nextExpiry, rec.expires);
  if (s.expiredQueue.length > 0 && s.releaseTimer === 0) {
    s.releaseTimer = setTimeout(() => {
      s.releaseTimer = 0;
      const q = s.expiredQueue;
      s.expiredQueue = [];
      release(s, q, ReleaseReason.EXPIRED);
    }, RELEASE_BATCH_MS) as unknown as number;
  }
}
