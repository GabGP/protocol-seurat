import { CREDIT_MIN, RECEIPT_MAX_AGE_MS } from '@/shared/config/constants';
import { linkRate, receiverWindow, synthesisHorizon } from '../credit';
import { bandChanged, receiptDue } from '../receipt-need';
import type { CreditIn, Policy } from './flow-sim';

/** The link window as ADR-08 accepted it: rate × (1 s + rtt), before the amendment. */
const WINDOW_S = 1;
export function windowAdr08(
  memory: number,
  linkBps: number,
  avg: number,
  rttS = 0,
  synthesis?: { parallel: number; jobMs: number },
): number {
  if (linkBps <= 0 || avg <= 0) return memory;
  const link = Math.ceil((linkBps * (WINDOW_S + rttS)) / avg);
  const bound = synthesis ? Math.min(link, synthesisHorizon(synthesis.parallel, synthesis.jobMs, rttS)) : link;
  return Math.min(memory, Math.max(CREDIT_MIN, bound));
}

/** The v1.0 receipt rule: every 8 deliveries, or when the window is 8 or less, or `timerMs` after one landed. */
const EVERY_N = 8;
const BUSY_MS = 150;

/** As built: the link window only; RECIBO every 8 deliveries or 100 ms. `timerMs` ±1 measures the bench's noise. */
export function asBuilt(name: string, timerMs: number): Policy {
  return {
    name,
    free: (c) => windowAdr08(c.memory, c.linkBps, c.avg, c.rttS),
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

type WindowFn = (c: CreditIn) => number;

function byNeedWith(name: string, maxAgeMs: number, window: WindowFn): Policy {
  return {
    name,
    free: window,
    due(d) {
      if (bandChanged(d.lastQueueMs, d.queueMs)) return true;
      if (d.pending === 0) return false;
      if (d.nowMs - d.oldestMs >= maxAgeMs) return true;
      return d.landed && receiptDue(d.pending, d.free(), d.lastFree);
    },
  };
}

/** ADR-08 through the client's own functions: link and synthesis horizons, receipts by need. `maxAgeMs` ±1 measures noise. */
export function byNeed(name: string, maxAgeMs: number): Policy {
  return byNeedWith(name, maxAgeMs, (c) =>
    windowAdr08(c.memory, c.linkBps, c.avg, c.rttS, { parallel: c.parallel, jobMs: c.decodeMs }),
  );
}

export const adr08 = byNeed('ADR-08', RECEIPT_MAX_AGE_MS);

/** ADR-08 amended through the client's own functions: clean RTT samples, the lower link rate, 8 before measurement. */
export const amended: Policy = {
  ...byNeedWith('ADR-08a', RECEIPT_MAX_AGE_MS, (c) =>
    receiverWindow(c.memory, linkRate(c.linkBps, c.arrivalBps), c.avg, c.rttS, {
      parallel: c.parallel,
      jobMs: c.decodeMs,
    }),
  ),
  cleanRtt: true,
};
