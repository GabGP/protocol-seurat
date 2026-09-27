import { describe, expect, it } from 'vitest';
import type { EvictCandidate } from '../evict-candidate';
import { rankHorizon } from '../horizon-rank';
import { simulate, type Ranker, type SimResult } from './eviction-sim';
import { TRACES } from './eviction-traces';

/**
 * The ordering the client used before Horizon (spec §5.2.3 keys, no recency): outside the
 * planner's 4× ring first, then the finest stratum, then the farthest from the gaze centre.
 */
const baseline: Ranker = (cands, { view: v }) => {
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  const inRing = (c: EvictCandidate): number => {
    const m = 4;
    const half = c.side / 2;
    const hit = c.stratum >= v.focus
      && c.cx - half < cx + (v.x1 - cx) * m && c.cx + half > cx - (cx - v.x0) * m
      && c.cy - half < cy + (v.y1 - cy) * m && c.cy + half > cy - (cy - v.y0) * m;
    return hit ? 1 : 0;
  };
  const dist = (c: EvictCandidate): number => Math.hypot(c.cx - cx, c.cy - cy);
  return [...cands].sort((a, b) => inRing(a) - inRing(b) || a.stratum - b.stratum || dist(b) - dist(a));
};

const POLICIES: Record<string, Ranker> = {
  baseline,
  kinematic: (cands, ctx) => rankHorizon(cands, ctx.gaze, ctx.heatOf, { heat: false }),
  horizon: (cands, ctx) => rankHorizon(cands, ctx.gaze, ctx.heatOf),
};

/** max_pinceladas: the spec's default without navigator.deviceMemory, and a Chromium desktop. */
const CAPACITIES = [128, 256] as const;

type Results = Record<string, Record<string, SimResult>>;

function runAll(cap: number): Results {
  const out: Results = {};
  for (const [trace, frames] of Object.entries(TRACES)) {
    out[trace] = {};
    for (const [name, rank] of Object.entries(POLICIES)) out[trace]![name] = simulate(frames, rank, cap);
  }
  return out;
}

const total = (r: Results, policy: string): number =>
  Object.values(r).reduce((n, byPolicy) => n + byPolicy[policy]!.stalls, 0);

describe('Horizon eviction benchmark (deterministic gaze traces)', () => {
  const results = new Map(CAPACITIES.map((cap) => [cap, runAll(cap)]));

  it('reports stalls (on-screen misses) / fetched brushes per trace and policy', () => {
    for (const [cap, r] of results) {
      const rows = Object.entries(r).map(([trace, byPolicy]) => ({
        cap, trace, ...Object.fromEntries(Object.entries(byPolicy).map(([p, s]) => [p, `${s.stalls} / ${s.fetched}`])),
      }));
      console.table([...rows, { cap, trace: 'TOTAL stalls', ...Object.fromEntries(Object.keys(POLICIES).map((p) => [p, total(r, p)])) }]);
      expect(rows).toHaveLength(Object.keys(TRACES).length);
    }
  });

  it.each(CAPACITIES)('Horizon stalls less than the previous ordering over all traces (cap %i)', (cap) => {
    const r = results.get(cap)!;
    expect(total(r, 'horizon')).toBeLessThan(total(r, 'baseline'));
  });

  it('is deterministic', () => {
    expect(simulate(TRACES.hotspots!, POLICIES.horizon!, 128)).toEqual(results.get(128)!.hotspots!.horizon);
  });
});
