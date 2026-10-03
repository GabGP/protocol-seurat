import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAZE_QUIET_IDLE_MS, RECEIPT_MAX_AGE_MS } from '@/shared/config/constants';
import { conePlanner, type ConeOpts } from './cone-plan';
import { ALL, DECODERS, LINKS, MIB, RECIBO_BYTES } from './flow-cases';
import { adr08, byNeed } from './flow-policies';
import { simulateFlow, type FlowResult, type Policy } from './flow-sim';

/** The server sees the QUIETA copy the client sends once the view rests. */
const QUIET_MS = GAZE_QUIET_IDLE_MS;

interface Arm { name: string; cone: ConeOpts; policy?: Policy }
const CENTRED: ConeOpts = { lead: false, ttn: false };
const NOISE = ['noise-1', 'noise+1'];
const ARMS: Arm[] = [
  { name: 'centred', cone: CENTRED },
  { name: NOISE[0]!, cone: CENTRED, policy: byNeed(NOISE[0]!, RECEIPT_MAX_AGE_MS - 1) },
  { name: NOISE[1]!, cone: CENTRED, policy: byNeed(NOISE[1]!, RECEIPT_MAX_AGE_MS + 1) },
  { name: 'ttn', cone: { lead: false, ttn: true } },
  { name: 'lead+ttn', cone: { lead: true, ttn: true } },
];

const METRICS = ['stalls', 'unseenMB', 'wireMB', 'staleMB', 'starved', 'transitMB', 'amber', 'red'] as const;
type Metric = (typeof METRICS)[number];
type Totals = Record<Metric, number>;

function add(t: Totals, r: FlowResult): void {
  t.stalls += r.stallFrames;
  t.unseenMB += r.unseen / MIB;
  t.wireMB += (r.bytes + r.receipts * RECIBO_BYTES) / MIB;
  t.staleMB += r.stale / MIB;
  t.starved += r.starvedMs;
  t.transitMB = Math.max(t.transitMB, r.peakTransit / MIB);
  t.amber += r.amber;
  t.red += r.red;
}

/** Per link × decoder, each arm's totals over every trace, and the per-trace rows for the report. */
function runAll(): { groups: Map<string, Map<string, Totals>>; rows: object[] } {
  const groups = new Map<string, Map<string, Totals>>();
  const rows: object[] = [];
  for (const link of LINKS) {
    for (const dec of DECODERS) {
      const byArm = new Map<string, Totals>();
      for (const arm of ARMS) {
        const t = Object.fromEntries(METRICS.map((m) => [m, 0])) as Totals;
        for (const [trace, frames] of Object.entries(ALL)) {
          const one = Object.fromEntries(METRICS.map((m) => [m, 0])) as Totals;
          const r = simulateFlow(frames, link, dec, arm.policy ?? adr08, { planner: conePlanner(arm.cone), quietMs: QUIET_MS });
          add(t, r);
          add(one, r);
          rows.push({ group: `${link.name}/${dec.name}`, trace, arm: arm.name, ...one });
        }
        byArm.set(arm.name, t);
      }
      groups.set(`${link.name}/${dec.name}`, byArm);
    }
  }
  return { groups, rows };
}

/** The larger of 1 % and what the ±1 ms arms moved: a difference inside it is noise. */
function tolerance(byArm: Map<string, Totals>, m: Metric): number {
  const base = byArm.get('centred')![m];
  return Math.max(0.01 * base, ...NOISE.map((n) => Math.abs(byArm.get(n)![m] - base)));
}

describe('ADR-10 cone bench: rings led along the pan, refuted against centred rings', () => {
  const { groups, rows } = runAll();

  it('reports every group, trace and arm', () => {
    if (process.env.CONE_OUT) writeFileSync(process.env.CONE_OUT, JSON.stringify(rows));
    expect(rows).toHaveLength(LINKS.length * DECODERS.length * Object.keys(ALL).length * ARMS.length);
  });

  it('leading rings deliver more brushes that never reach the screen, and more bytes, on every link and decoder', () => {
    for (const [group, byArm] of groups) {
      const base = byArm.get('centred')!;
      const led = byArm.get('lead+ttn')!;
      expect(led.unseenMB, group).toBeGreaterThan(base.unseenMB + tolerance(byArm, 'unseenMB'));
      expect(led.wireMB, group).toBeGreaterThan(base.wireMB + tolerance(byArm, 'wireMB'));
    }
  });

  it('time-to-need order alone moves no stall count beyond the noise', () => {
    for (const [group, byArm] of groups) {
      const d = byArm.get('ttn')!.stalls - byArm.get('centred')!.stalls;
      expect(Math.abs(d), group).toBeLessThanOrEqual(tolerance(byArm, 'stalls'));
    }
  });
});
