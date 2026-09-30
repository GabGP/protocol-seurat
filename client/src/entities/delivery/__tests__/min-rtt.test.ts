import { describe, expect, it } from 'vitest';
import { CREDIT_RTT_MAX_S, CREDIT_RTT_WINDOW_MS, RTT_PENDING_MAX } from '@/shared/config/constants';
import { MinRtt } from '../sink/min-rtt';

describe('MinRtt estimator', () => {
  it('samples on the first PLAN only and ignores subsequent PLANs for the same seq', () => {
    const rtt = new MinRtt();
    rtt.sent(1, 1000);
    rtt.answered(1, 1200); // 200 ms = 0.2 s
    expect(rtt.seconds(1200)).toBeCloseTo(0.2, 5);

    // Second PLAN event (e.g. FIN after INICIO) for the same gazeSeq produces no sample
    rtt.answered(1, 2500);
    expect(rtt.seconds(2500)).toBeCloseTo(0.2, 5);
  });

  it('ignores answers for unknown seqs and reports 0 before any sample', () => {
    const rtt = new MinRtt();
    expect(rtt.seconds(1000)).toBe(0);

    rtt.answered(999, 1500);
    expect(rtt.seconds(1500)).toBe(0);
  });

  it('tracks the minimum sample within CREDIT_RTT_WINDOW_MS', () => {
    const rtt = new MinRtt();
    rtt.sent(1, 1000);
    rtt.answered(1, 1500); // 0.5 s
    rtt.sent(2, 2000);
    rtt.answered(2, 2200); // 0.2 s
    rtt.sent(3, 3000);
    rtt.answered(3, 3600); // 0.6 s

    // Minimum of {0.5, 0.2, 0.6} within the 30 s window is 0.2 s
    expect(rtt.seconds(3600)).toBeCloseTo(0.2, 5);
  });

  it('falls back to the most recent sample after the window expires', () => {
    const rtt = new MinRtt();
    rtt.sent(1, 1000);
    rtt.answered(1, 1300); // 0.3 s
    rtt.sent(2, 2000);
    rtt.answered(2, 2700); // 0.7 s (most recent)

    // Advance beyond CREDIT_RTT_WINDOW_MS from sample 2: 2700 + 30000 = 32700
    expect(rtt.seconds(35_000)).toBeCloseTo(0.7, 5);
  });

  it('clamps samples to CREDIT_RTT_MAX_S', () => {
    const rtt = new MinRtt();
    rtt.sent(1, 1000);
    rtt.answered(1, 10_000); // 9 s elapsed -> clamps to CREDIT_RTT_MAX_S = 4 s
    expect(rtt.seconds(10_000)).toBe(CREDIT_RTT_MAX_S);
  });

  it('bounds pending seqs to RTT_PENDING_MAX by dropping the oldest', () => {
    const rtt = new MinRtt();
    for (let i = 1; i <= RTT_PENDING_MAX + 5; i++) {
      rtt.sent(i, 1000 + i);
    }
    expect(rtt.pendingCount).toBe(RTT_PENDING_MAX);

    // Oldest seq 1 was dropped, so answering it yields no sample
    rtt.answered(1, 2000);
    expect(rtt.seconds(2000)).toBe(0);

    // Surviving seqs can still be answered
    const newestSeq = RTT_PENDING_MAX + 5;
    rtt.answered(newestSeq, 2000);
    expect(rtt.seconds(2000)).toBeCloseTo((2000 - (1000 + newestSeq)) / 1000, 5);
  });

  it('re-learns a higher RTT once earlier lower samples expire from the window', () => {
    const rtt = new MinRtt();
    rtt.sent(1, 1000);
    rtt.answered(1, 1100); // 0.1 s
    expect(rtt.seconds(1100)).toBeCloseTo(0.1, 5);

    // Network throttled: higher latency sample after sample 1 expired
    const t2 = 1000 + CREDIT_RTT_WINDOW_MS + 5000;
    rtt.sent(2, t2);
    rtt.answered(2, t2 + 1800); // 1.8 s
    expect(rtt.seconds(t2 + 2000)).toBeCloseTo(1.8, 5);
  });

  it('ignores non-positive seq numbers', () => {
    const rtt = new MinRtt();
    rtt.sent(0, 1000);
    rtt.sent(-5, 1000);
    expect(rtt.pendingCount).toBe(0);
    rtt.answered(0, 1500);
    rtt.answered(-5, 1500);
    expect(rtt.seconds(1500)).toBe(0);
  });
});
