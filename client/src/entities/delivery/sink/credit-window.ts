import { BYTES_PER_KIB } from '@/shared/config/constants';
import { clamp } from '@/shared/lib/clamp';
import { byteRoom, coming, receiverWindow } from '../credit';
import { heldBrushes, ownedBytes } from '../store';
import { holdLimit, type SinkState } from './state';

/** Deliveries that still fit in max_kib after what may arrive before the server reads the next RECIBO. */
export function byteWindow(s: SinkState): number {
  const room = byteRoom(s.limits.maxKiB() * BYTES_PER_KIB - ownedBytes(s.book), s.largest, s.avgDelivery);
  return room - coming(Math.max(0, s.lastFree), s.book.pendingReceipt.length);
}

/**
 * RECIBO.libre: the memory window (brushes and max_kib), sized by link rate and min RTT (spec §6.1)
 * so high-latency links stay full without queuing excessive deliveries ahead of a new MIRADA.
 */
export function free(s: SinkState): number {
  const memory = clamp(holdLimit(s) - heldBrushes(s.book), 0, byteWindow(s));
  const peak = s.port()?.meter?.peak(performance.now()) ?? 0;
  // Only a second that carried at least one brush measures the link; idle keeps the last rate,
  // so the next view starts with a full window instead of re-ramping from CREDIT_MIN.
  if (s.avgDelivery > 0 && peak >= s.avgDelivery) s.linkBps = peak;
  return receiverWindow(memory, s.linkBps, s.avgDelivery, s.rtt.seconds(performance.now()));
}
