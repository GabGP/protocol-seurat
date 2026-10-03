import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RECEIPT_MAX_AGE_MS } from '@/shared/config/constants';
import { CREDIT_LINKS, DECODERS } from './flow-cases';
import { adr08, amended, byNeed } from './flow-policies';
import type { Policy } from './flow-sim';
import { METRICS, runGroups, tolerance } from './flow-totals';

const NOISE = [
  byNeed('ADR-08-1ms', RECEIPT_MAX_AGE_MS - 1),
  byNeed('ADR-08+1ms', RECEIPT_MAX_AGE_MS + 1),
];
const NOISE_NAMES = NOISE.map((p) => p.name);
const ARMS: Policy[] = [adr08, ...NOISE, amended];

/**
 * ADR-08 amendment bench: clean round trips, the lower link rate and the opening credit,
 * against ADR-08 as accepted.
 */
describe('ADR-08 amendment bench: clean round trips, the lower link rate and the opening credit, against ADR-08 as accepted', () => {
  const groups = runGroups(CREDIT_LINKS, DECODERS, ARMS);

  it('reports every group and arm', () => {
    const rows = [...groups].flatMap(([group, byArm]) => [...byArm].map(([arm, t]) => ({
      group, arm, ...Object.fromEntries(METRICS.map((m) => [m, +t[m].toFixed(2)])),
      receiptsPer1k: Math.round((t.receipts * 1000) / Math.max(1, t.deliveries)),
      planLagMs: +(t.planLagMs / Math.max(1, t.plans)).toFixed(2),
    })));
    if (process.env.CREDIT_OUT) writeFileSync(process.env.CREDIT_OUT, JSON.stringify(rows));
    expect(rows).toHaveLength(CREDIT_LINKS.length * DECODERS.length * ARMS.length);
  });

  it('is never worse than ADR-08 beyond the bench noise, on any link and decoder', () => {
    for (const [group, byArm] of groups) {
      const base = byArm.get(adr08.name)!;
      const next = byArm.get(amended.name)!;
      for (const m of METRICS) {
        expect(next[m], `${group} ${m}`).toBeLessThanOrEqual(base[m] + tolerance(byArm, m, adr08.name, NOISE_NAMES));
      }
    }
  });

  it('on the throttled 3G link, a new view waits behind less: mean plan lag of amended <= 0.85 x adr08 and stale data falls', () => {
    for (const group of ['dt3g/fast', 'dt3g/slow']) {
      const byArm = groups.get(group)!;
      const base = byArm.get(adr08.name)!;
      const next = byArm.get(amended.name)!;
      const baseLag = base.planLagMs / Math.max(1, base.plans);
      const nextLag = next.planLagMs / Math.max(1, next.plans);
      expect(nextLag, `${group} planLagMs`).toBeLessThanOrEqual(0.85 * baseLag);
      expect(next.staleMB, `${group} staleMB`).toBeLessThan(
        base.staleMB - tolerance(byArm, 'staleMB', adr08.name, NOISE_NAMES),
      );
    }
  });

  it('keeps a long round trip full: no more bubbles than ADR-08 on far', () => {
    for (const [group, byArm] of groups) {
      if (!group.startsWith('far/')) continue;
      const base = byArm.get(adr08.name)!;
      const next = byArm.get(amended.name)!;
      expect(next.starved, `${group} starved`).toBeLessThanOrEqual(
        base.starved + tolerance(byArm, 'starved', adr08.name, NOISE_NAMES),
      );
    }
  });
});
