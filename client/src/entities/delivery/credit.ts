import {
  BYTES_PER_KIB,
  CREDIT_BATCH_GAIN,
  CREDIT_MIN,
  CREDIT_QUEUE_TARGET_MS,
  CREDIT_UNMEASURED,
  CREDIT_WINDOW_S,
  KIB_PER_BRUSH,
  MS_PER_S,
  WIRE_FLOWS,
} from '@/shared/config/constants';

/**
 * ADR-08 synthesis horizon: what the workers drain in one round trip plus CREDIT_QUEUE_TARGET_MS,
 * grown by CREDIT_BATCH_GAIN for the deliveries waiting for their RECIBO. Granting no more keeps
 * the client's own credit from pushing cola_ms to amber.
 */
export function synthesisHorizon(parallel: number, jobMs: number, rttS: number): number {
  if (jobMs <= 0) return Infinity;
  return Math.ceil((CREDIT_BATCH_GAIN * (CREDIT_QUEUE_TARGET_MS + rttS * MS_PER_S) * parallel) / jobMs);
}

/**
 * RECIBO.libre (ADR-08): the smaller of the link horizon (what the link carries in CREDIT_WINDOW_S
 * plus one round trip) and the synthesis horizon, inside the memory window. Before the link is
 * measured, libre is CREDIT_UNMEASURED (or memory if smaller), matching the server's opening credit (§4.1 c).
 */
export function receiverWindow(
  memory: number,
  linkBps: number,
  avgDelivery: number,
  rttS = 0,
  synthesis?: { parallel: number; jobMs: number },
): number {
  if (linkBps <= 0 || avgDelivery <= 0) return Math.min(memory, CREDIT_UNMEASURED);
  const link = Math.ceil((linkBps * (CREDIT_WINDOW_S + rttS)) / avgDelivery);
  const bound = synthesis ? Math.min(link, synthesisHorizon(synthesis.parallel, synthesis.jobMs, rttS)) : link;
  return Math.min(memory, Math.max(CREDIT_MIN, bound));
}

/**
 * The link rate the window is sized by: the busiest second, unless deliveries arriving back to back show a lower
 * rate. A second can hold one delivery more than the link carried in it (deliveries are counted when they end), so
 * when one delivery is a large part of a second the busiest second overstates the link (ADR-08 amendment).
 */
export function linkRate(peakBps: number, arrivalBps: number): number {
  return arrivalBps > 0 ? Math.min(peakBps, arrivalBps) : peakBps;
}

/**
 * Deliveries that still fit in `roomBytes` of max_kib: one as large as the `largest` yet, the rest
 * at the `average` (KIB_PER_BRUSH before any came). The server opens by count only (spec 4.1 c),
 * so max_kib holds only if the window also leaves room for what may still come (spec 5.4).
 * Reserving the largest for every one would close the window with most of max_kib unused.
 */
export function byteRoom(roomBytes: number, largest: number, average: number): number {
  const each = average > 0 ? average : KIB_PER_BRUSH * BYTES_PER_KIB;
  return Math.max(0, Math.floor((roomBytes - Math.max(largest, each)) / each) + 1);
}

/**
 * What may still come without a new grant: the flows on the wire (at most WIRE_FLOWS, spec 6.1)
 * and the part of the last RECIBO.libre (`granted`) that `arrived` deliveries have not used.
 */
export function coming(granted: number, arrived: number): number {
  return WIRE_FLOWS + Math.max(0, granted - arrived);
}
