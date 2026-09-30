import { BYTES_PER_KIB, CREDIT_MIN, CREDIT_WINDOW_S, KIB_PER_BRUSH, WIRE_FLOWS } from '@/shared/config/constants';

/**
 * RECIBO.libre: the memory window, sized via Little's law (spec §6.1: in flight = rate × (RTT + transmission))
 * to rate × (CREDIT_WINDOW_S + rttS) / avgDelivery. Unmeasured links get the memory window (the server starts at 8).
 */
export function receiverWindow(memory: number, linkBps: number, avgDelivery: number, rttS = 0): number {
  if (linkBps <= 0 || avgDelivery <= 0) return memory;
  return Math.min(memory, Math.max(CREDIT_MIN, Math.ceil((linkBps * (CREDIT_WINDOW_S + rttS)) / avgDelivery)));
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
