import { ReleaseReason } from '@/shared/config/constants';
import type { SinkState } from './state';

/** SOLTAR for these numbers (sorted, none when empty). */
export function release(s: SinkState, ranges: number[], reason: number): void {
  if (ranges.length === 0) return;
  s.port()?.sendRelease(s.handle, reason, [...ranges].sort((a, b) => a - b));
}

/** Spec 5.2: SOLTAR must precede anything account-dependent (RASPADO/INVENTARIO). */
export function flushRelease(s: SinkState): void {
  if (s.expiredQueue.length === 0) return;
  if (s.releaseTimer !== 0) {
    clearTimeout(s.releaseTimer);
    s.releaseTimer = 0;
  }
  const q = s.expiredQueue;
  s.expiredQueue = [];
  release(s, q, ReleaseReason.EXPIRED);
}
