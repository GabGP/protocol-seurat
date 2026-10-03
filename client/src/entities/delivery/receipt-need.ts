import {
  QUEUE_AMBER_MS,
  QUEUE_RED_MS,
  RECEIPT_BATCH,
  RECEIPT_MOVE,
  RECEIPT_MOVE_MIN,
} from '@/shared/config/constants';

const BAND_GREEN = 0;
const BAND_AMBER = 1;
const BAND_RED = 2;

/** cola_ms band as the server reads it (spec 6.1): 0 green, 1 amber, 2 red. */
export function queueBand(ms: number): number {
  if (ms > QUEUE_RED_MS) return BAND_RED;
  if (ms >= QUEUE_AMBER_MS) return BAND_AMBER;
  return BAND_GREEN;
}

/** ADR-08 (b): the band changed in a direction the server acts on: up (amber, red) or back to green. */
export function bandChanged(lastMs: number, ms: number): boolean {
  const was = queueBand(lastMs);
  const is = queueBand(ms);
  return is !== was && (is === BAND_GREEN || is > was);
}

/** ADR-08 (a): on a landing, a RECIBO is due once a quarter of the last libre waits, or libre moved by a quarter. */
export function receiptDue(pending: number, free: number, lastFree: number): boolean {
  return pending >= Math.max(1, Math.ceil(lastFree * RECEIPT_BATCH))
    || Math.abs(free - lastFree) >= Math.max(RECEIPT_MOVE_MIN, RECEIPT_MOVE * lastFree);
}
