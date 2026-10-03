import { ALL, MIB, RECIBO_BYTES } from './flow-cases';
import { simulateFlow, type Decoder, type FlowResult, type Link, type Policy } from './flow-sim';

export const METRICS = ['stalls', 'starved', 'staleMB', 'transitMB', 'wireMB', 'amber', 'red'] as const;
export type Metric = (typeof METRICS)[number];
export type Totals = Record<Metric | 'receipts' | 'deliveries' | 'planLagMs' | 'plans', number>;

export function add(t: Totals, r: FlowResult): void {
  t.stalls += r.stallFrames;
  t.starved += r.starvedMs;
  t.staleMB += r.stale / MIB;
  t.transitMB = Math.max(t.transitMB, r.peakTransit / MIB);
  t.wireMB += (r.bytes + r.receipts * RECIBO_BYTES) / MIB;
  t.amber += r.amber;
  t.red += r.red;
  t.receipts += r.receipts;
  t.deliveries += r.deliveries;
  t.planLagMs += r.planLagMs;
  t.plans += r.plans;
}

/** Per link × decoder, each arm's totals over every trace. */
export function runGroups(
  links: readonly Link[],
  decoders: readonly Decoder[],
  arms: readonly Policy[],
): Map<string, Map<string, Totals>> {
  const out = new Map<string, Map<string, Totals>>();
  for (const link of links) {
    for (const dec of decoders) {
      const byArm = new Map<string, Totals>();
      for (const arm of arms) {
        const t: Totals = {
          stalls: 0, starved: 0, staleMB: 0, transitMB: 0, wireMB: 0, amber: 0, red: 0,
          receipts: 0, deliveries: 0, planLagMs: 0, plans: 0,
        };
        for (const frames of Object.values(ALL)) add(t, simulateFlow(frames, link, dec, arm));
        byArm.set(arm.name, t);
      }
      out.set(`${link.name}/${dec.name}`, byArm);
    }
  }
  return out;
}

/** The larger of 1 % of the base and what the noise arms moved: a difference inside it is noise. */
export function tolerance(
  byArm: Map<string, Totals>,
  m: Metric,
  baseName: string,
  noiseNames: readonly string[],
): number {
  const base = byArm.get(baseName)![m];
  return Math.max(0.01 * base, ...noiseNames.map((name) => Math.abs(byArm.get(name)![m] - base)));
}
