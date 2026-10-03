import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GAZE_QUIET_IDLE_MS } from '@/shared/config/constants';
import { teselasDecode, teselasEncode } from '@/shared/proto/teselas';
import { rangosDecode, rangosEncode } from '@/shared/proto/testing/rangos-ref';
import { rankHorizon } from '../horizon-rank';
import { conePlanner } from './cone-plan';
import { simulate } from './eviction-sim';
import { TRACES } from './eviction-traces';
import { ALL, DECODERS, LINKS } from './flow-cases';
import { adr08 } from './flow-policies';
import { simulateFlow } from './flow-sim';

/**
 * ADR-09 bench: the delivery sets the ADR-02 and ADR-08 replays put on the wire, encoded as v1.0
 * `Rangos` and as `Teselas`. `soltar` and `held` (RENOVAR, INVENTARIO, a claim) come from the
 * eviction replay at both capacities with Horizon; `recibo` from the flow replay on every link and
 * decoder with the server's centred cone. Bytes per set, per trace and kind, and codec time.
 */
type Kind = 'recibo' | 'soltar' | 'held';
const KINDS: Kind[] = ['recibo', 'soltar', 'held'];
const CAPACITIES = [128, 256] as const;
/** Timed passes over the whole corpus; the fastest pass of each codec counts. */
const PASSES = 7;
/** Decode times tie (both expand the same numbers): the gate allows timer and scheduling noise. */
const DECODE_TOLERANCE = 1.25;

type Corpus = Map<string, Map<Kind, number[][]>>;

function record(): Corpus {
  const out: Corpus = new Map();
  const put = (trace: string, kind: Kind, nums: number[]): void => {
    const byKind = out.get(trace) ?? new Map<Kind, number[][]>();
    out.set(trace, byKind);
    byKind.set(kind, [...(byKind.get(kind) ?? []), nums]);
  };
  const horizon = (cands: Parameters<typeof rankHorizon>[0], ctx: { gaze: Parameters<typeof rankHorizon>[1]; heatOf: (k: string) => number }) =>
    rankHorizon(cands, ctx.gaze, ctx.heatOf);
  for (const [trace, frames] of Object.entries(TRACES)) {
    for (const cap of CAPACITIES) simulate(frames, horizon, cap, (kind, nums) => put(trace, kind, nums));
  }
  for (const link of LINKS) {
    for (const dec of DECODERS) {
      for (const [trace, frames] of Object.entries(ALL)) {
        simulateFlow(frames, link, dec, adr08, {
          planner: conePlanner({ lead: false, ttn: false }), quietMs: GAZE_QUIET_IDLE_MS, onReceipt: (nums) => put(trace, 'recibo', nums),
        });
      }
    }
  }
  return out;
}

const sorted = (s: readonly number[]): number[] => [...new Set(s)].sort((a, b) => a - b);

/** Fastest of PASSES runs of `f` over every input, in ms. */
function timed<T>(inputs: readonly T[], f: (x: T) => void): number {
  let best = Infinity;
  for (let p = 0; p < PASSES; p++) {
    const t0 = performance.now();
    for (const x of inputs) f(x);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('ADR-09 Teselas against Rangos on the replayed sets', () => {
  const corpus = record();
  const all = [...corpus.values()].flatMap((byKind) => [...byKind.values()].flat());
  const report: { rows: object[]; times: object[] } = { rows: [], times: [] };

  it('round-trips every set and is never longer than Rangos', () => {
    for (const s of all) {
      const t = teselasEncode(s);
      expect(teselasDecode(t, 0).values).toEqual(sorted(s));
      expect(t.length).toBeLessThanOrEqual(rangosEncode(s).length);
    }
  });

  it('reports bytes per trace and kind, and is shorter on every eviction trace', () => {
    const rows = report.rows;
    const sum = { rangos: 0, teselas: 0 };
    for (const [trace, byKind] of corpus) {
      for (const kind of KINDS) {
        const sets = byKind.get(kind) ?? [];
        if (sets.length === 0) continue;
        let r = 0;
        let t = 0;
        let blocks = 0;
        for (const s of sets) {
          const tb = teselasEncode(s);
          r += rangosEncode(s).length;
          t += tb.length;
          if (tb[0] === 0 && tb[1] !== 0) blocks++;
        }
        sum.rangos += r;
        sum.teselas += t;
        rows.push({ trace, kind, sets: sets.length, rangosB: r, teselasB: t, delta: `${(((t - r) / r) * 100).toFixed(1)} %`, blockForm: blocks });
        if (kind !== 'recibo') expect(t).toBeLessThan(r);
      }
    }
    rows.push({ trace: 'TOTAL', rangosB: sum.rangos, teselasB: sum.teselas, delta: `${(((sum.teselas - sum.rangos) / sum.rangos) * 100).toFixed(1)} %` });
    console.table(rows);
  });

  it('encodes faster than Rangos and decodes as fast, over the corpus', () => {
    const rb = all.map((s) => rangosEncode(s));
    const tb = all.map((s) => teselasEncode(s));
    const times = {
      rangosEncode: timed(all, (s) => rangosEncode(s)),
      teselasEncode: timed(all, (s) => teselasEncode(s)),
      rangosDecode: timed(rb, (b) => rangosDecode(b, 0)),
      teselasDecode: timed(tb, (b) => teselasDecode(b, 0)),
    };
    report.times.push({ sets: all.length, numbers: all.reduce((n, s) => n + s.length, 0), ...times });
    console.table(report.times);
    if (process.env.TESELAS_OUT) writeFileSync(process.env.TESELAS_OUT, JSON.stringify(report, null, 2));
    expect(times.teselasEncode).toBeLessThan(times.rangosEncode);
    expect(times.teselasDecode).toBeLessThan(times.rangosDecode * DECODE_TOLERANCE);
  });
});
