import { RECEIPT_MAX_AGE_MS } from '@/shared/config/constants';
import { receiverWindow } from '../credit';
import { bandChanged, receiptDue } from '../receipt-need';
import type { Policy } from './flow-sim';

/** The v1.0 receipt rule: every 8 deliveries, or when the window is 8 or less, or `timerMs` after one landed. */
const EVERY_N = 8;
const BUSY_MS = 150;

/** As built: the link window only; RECIBO every 8 deliveries or 100 ms. `timerMs` ±1 measures the bench's noise. */
export function asBuilt(name: string, timerMs: number): Policy {
  return {
    name,
    free: (c) => receiverWindow(c.memory, c.linkBps, c.avg, c.rttS),
    due(d, st) {
      if (d.lastQueueMs >= BUSY_MS && d.queueMs < BUSY_MS) return true;
      if (d.landed) {
        if (d.pending >= EVERY_N || d.free() <= EVERY_N) return true;
        if (st.timerAt === 0 && d.pending > 0) st.timerAt = d.nowMs + timerMs;
      }
      if (st.timerAt !== 0 && d.nowMs >= st.timerAt) {
        st.timerAt = 0;
        return true;
      }
      return false;
    },
  };
}

export const today = asBuilt('v1.0', 100);

/** ADR-08 through the client's own functions: link and synthesis horizons, receipts by need. `maxAgeMs` ±1 measures noise. */
export function byNeed(name: string, maxAgeMs: number): Policy {
  return {
    name,
    free: (c) => receiverWindow(c.memory, c.linkBps, c.avg, c.rttS, { parallel: c.parallel, jobMs: c.decodeMs }),
    due(d) {
      if (bandChanged(d.lastQueueMs, d.queueMs)) return true;
      if (d.pending === 0) return false;
      if (d.nowMs - d.oldestMs >= maxAgeMs) return true;
      return d.landed && receiptDue(d.pending, d.free(), d.lastFree);
    },
  };
}

export const adr08 = byNeed('ADR-08', RECEIPT_MAX_AGE_MS);
