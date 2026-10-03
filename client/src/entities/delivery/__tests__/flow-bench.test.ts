import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL, DECODERS, LINKS, MIB, RECIBO_BYTES } from './flow-cases';
import { adr08, asBuilt, today } from './flow-policies';
import { simulateFlow, type FlowResult, type Policy } from './flow-sim';

/** v1.0 with its 100 ms timer moved by 1 ms each way: how far the bench moves for no real change. */
const NOISE = [asBuilt('v1.0-1ms', 99), asBuilt('v1.0+1ms', 101)];
const ARMS: Policy[] = [today, ...NOISE, adr08];

/**
 * The one known cost (ADR-08 Evidence): on a 1 MiB/s link the loop also runs through the server's
 * open flows, which the round trip leaves out, so the synthesis horizon of a slow decoder leaves
 * the link idle a little longer, on ring prefetch the user does not wait for.
 */
const STARVED_EXCEPTION = 'slow/slow';

const METRICS = ['stalls', 'starved', 'staleMB', 'transitMB', 'wireMB', 'amber', 'red'] as const;
type Metric = (typeof METRICS)[number];
type Totals = Record<Metric | 'receipts' | 'deliveries', number>;

function add(t: Totals, r: FlowResult): void {
  t.stalls += r.stallFrames;
  t.starved += r.starvedMs;
  t.staleMB += r.stale / MIB;
  t.transitMB = Math.max(t.transitMB, r.peakTransit / MIB);
  t.wireMB += (r.bytes + r.receipts * RECIBO_BYTES) / MIB;
  t.amber += r.amber;
  t.red += r.red;
  t.receipts += r.receipts;
  t.deliveries += r.deliveries;
}

/** Per link × decoder, each arm's totals over every trace. */
function runAll(): Map<string, Map<string, Totals>> {
  const out = new Map<string, Map<string, Totals>>();
  for (const link of LINKS) {
    for (const dec of DECODERS) {
      const byArm = new Map<string, Totals>();
      for (const arm of ARMS) {
        const t: Totals = { stalls: 0, starved: 0, staleMB: 0, transitMB: 0, wireMB: 0, amber: 0, red: 0, receipts: 0, deliveries: 0 };
        for (const frames of Object.values(ALL)) add(t, simulateFlow(frames, link, dec, arm));
        byArm.set(arm.name, t);
      }
      out.set(`${link.name}/${dec.name}`, byArm);
    }
  }
  return out;
}

/** The larger of 1 % and what the ±1 ms arms moved: a difference inside it is noise. */
function tolerance(byArm: Map<string, Totals>, m: Metric): number {
  const base = byArm.get(today.name)![m];
  return Math.max(0.01 * base, ...NOISE.map((p) => Math.abs(byArm.get(p.name)![m] - base)));
}

describe('ADR-08 flow bench: synthesis horizon and receipts by need against v1.0', () => {
  const groups = runAll();

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
        expect(next[m], `${group} ${m}`).toBeLessThanOrEqual(base[m] + tolerance(byArm, m));
      }
    }
  });

  it(`on ${STARVED_EXCEPTION}, bubbles rise at most 15 % and stalls still fall beyond the noise`, () => {
    const byArm = groups.get(STARVED_EXCEPTION)!;
    const base = byArm.get(today.name)!;
    const next = byArm.get(adr08.name)!;
    expect(next.starved).toBeLessThanOrEqual(1.15 * base.starved);
    expect(next.stalls).toBeLessThan(base.stalls - tolerance(byArm, 'stalls'));
  });

  it('with a slow decoder: a fifth fewer stalls at least, and no red trips', () => {
    for (const [group, byArm] of groups) {
      if (!group.endsWith('/slow') || group.startsWith('slow/')) continue; // a 1 MiB/s link starves any decoder
      expect(byArm.get(adr08.name)!.stalls, group).toBeLessThanOrEqual(0.8 * byArm.get(today.name)!.stalls);
      expect(byArm.get(adr08.name)!.red, group).toBe(0);
    }
  });
});
