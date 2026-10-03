import { MS_PER_S, RECEIPT_MAX_AGE_MS } from '@/shared/config/constants';
import { bandChanged, receiptDue } from '../receipt-need';
import { free } from './credit-window';
import { relieve } from './eviction';
import { flushRelease } from './release';
import type { SinkState } from './state';

/** ADR-08 (b): cola_ms changed band in a direction the server acts on; tell it now. */
export function onQueueChange(s: SinkState): void {
  if (bandChanged(s.lastQueue, s.decode.ms)) flushReceipt(s);
}

/**
 * RECIBO by need (ADR-08): a quarter of the window waiting, or a moved window;
 * otherwise the oldest unconfirmed delivery waits at most RECEIPT_MAX_AGE_MS.
 */
export function maybeFlushReceipt(s: SinkState): void {
  const pending = s.book.pendingReceipt.length;
  if (pending > 0 && receiptDue(pending, free(s), s.lastFree)) {
    flushReceipt(s);
    return;
  }
  if (s.receiptTimer === 0 && pending > 0) {
    s.receiptTimer = setTimeout(() => {
      s.receiptTimer = 0;
      flushReceipt(s);
    }, RECEIPT_MAX_AGE_MS) as unknown as number;
  }
}

export function flushReceipt(s: SinkState): void {
  flushRelease(s);
  relieve(s); // §5.2.3: SOLTAR motivo 1 goes out before anything that depends on the count
  const q = s.book.pendingReceipt;
  const window = free(s);
  const queue = Math.round(s.decode.ms);
  // Nothing the server acts on changed: no new receipts, window, backlog or renewal to confirm.
  if (q.length === 0 && window === s.lastFree && queue === s.lastQueue && s.renewThrough === s.lastRenew) return;
  clearTimeout(s.receiptTimer);
  s.receiptTimer = 0;
  s.book.pendingReceipt = [];
  s.lastFree = window;
  s.lastQueue = queue;
  s.lastRenew = s.renewThrough;
  for (const n of q) s.book.inFlight.delete(n);
  for (const n of q) {
    const rec = s.book.byDelivery.get(n);
    if (rec) {
      rec.receiptQueued = false;
      rec.receiptSent = true;
    }
  }
  s.port()?.sendReceipt(s.handle, [...q].sort((a, b) => a - b), queue, window, s.renewThrough);
}

/** RENOVAR: the listed leases restart from now; the order is confirmed in the next RECIBO. */
export function applyRenew(s: SinkState, ranges: number[], order: number, leaseS: number, now: () => number): void {
  s.renewThrough = Math.max(s.renewThrough, order);
  const t = now() + leaseS * MS_PER_S;
  for (const n of ranges) {
    const rec = s.book.byDelivery.get(n);
    if (rec) rec.expires = t;
  }
  flushReceipt(s);
}
