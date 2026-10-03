import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DECODERS, LINKS } from './flow-cases';
import { adr08, asBuilt, today } from './flow-policies';
import type { Policy } from './flow-sim';
import { METRICS, runGroups, tolerance } from './flow-totals';

/** v1.0 with its 100 ms timer moved by 1 ms each way: how far the bench moves for no real change. */
const NOISE = [asBuilt('v1.0-1ms', 99), asBuilt('v1.0+1ms', 101)];
const NOISE_NAMES = NOISE.map((p) => p.name);
const ARMS: Policy[] = [today, ...NOISE, adr08];

/**
 * The one known cost (ADR-08 Evidence): on a 1 MiB/s link the loop also runs through the server's
 * open flows, which the round trip leaves out, so the synthesis horizon of a slow decoder leaves
 * the link idle a little longer, on ring prefetch the user does not wait for.
 */
const STARVED_EXCEPTION = 'slow/slow';

describe('ADR-08 flow bench: synthesis horizon and receipts by need against v1.0', () => {
  const groups = runGroups(LINKS, DECODERS, ARMS);

  it('reports every group and arm', () => {
    const rows = [...groups].flatMap(([group, byArm]) => [...byArm].map(([arm, t]) => ({
      group, arm, ...Object.fromEntries(METRICS.map((m) => [m, +t[m].toFixed(2)])),
      receiptsPer1k: Math.round((t.receipts * 1000) / Math.max(1, t.deliveries)),
    })));
    if (process.env.FLOW_OUT) writeFileSync(process.env.FLOW_OUT, JSON.stringify(rows));
    expect(rows).toHaveLength(LINKS.length * DECODERS.length * ARMS.length);
  });

  it('is never worse than v1.0 beyond the bench noise, on any link and decoder', () => {
    for (const [group, byArm] of groups) {
      const base = byArm.get(today.name)!;
      const next = byArm.get(adr08.name)!;
      for (const m of METRICS) {
        if (group === STARVED_EXCEPTION && m === 'starved') continue;
        expect(next[m], `${group} ${m}`).toBeLessThanOrEqual(base[m] + tolerance(byArm, m, today.name, NOISE_NAMES));
      }
    }
  });

  it(`on ${STARVED_EXCEPTION}, bubbles rise at most 15 % and stalls still fall beyond the noise`, () => {
    const byArm = groups.get(STARVED_EXCEPTION)!;
    const base = byArm.get(today.name)!;
    const next = byArm.get(adr08.name)!;
    expect(next.starved).toBeLessThanOrEqual(1.15 * base.starved);
    expect(next.stalls).toBeLessThan(base.stalls - tolerance(byArm, 'stalls', today.name, NOISE_NAMES));
  });

  it('with a slow decoder: a fifth fewer stalls at least, and no red trips', () => {
    for (const [group, byArm] of groups) {
      if (!group.endsWith('/slow') || group.startsWith('slow/')) continue; // a 1 MiB/s link starves any decoder
      expect(byArm.get(adr08.name)!.stalls, group).toBeLessThanOrEqual(0.8 * byArm.get(today.name)!.stalls);
      expect(byArm.get(adr08.name)!.red, group).toBe(0);
    }
  });
});
