import { describe, expect, it } from 'vitest';
import { TILE } from '@/shared/config/constants';
import { makeBrushId } from '@/shared/proto/brush';
import { collectCandidates, type EvictCandidate, type EvictView } from '../evict-candidate';
import type { GazeState } from '../gaze-motion';
import { rankHorizon, timeToNeed } from '../horizon-rank';
import { emptyLedger, type DeliveryLedger } from '../store';

function cand(key: string, stratum: number, cx: number, cy: number): EvictCandidate {
  return { key, recs: [], stratum, cx, cy, side: TILE * 2 ** stratum };
}

const still = (over: Partial<GazeState> = {}): GazeState => ({ x: 0, y: 0, z: 0, r: 512, vx: 0, vy: 0, vz: 0, ...over });
const cold = (): number => 0;
const keys = (cs: EvictCandidate[]): string[] => cs.map((c) => c.key);

describe('rankHorizon (kinematic Bélády + attention heat)', () => {
  it('with a still gaze evicts the farthest first', () => {
    const cs = [cand('near', 0, 2000, 0), cand('far', 0, 9000, 0), cand('mid', 0, 5000, 0)];
    expect(keys(rankHorizon(cs, still(), cold))).toEqual(['far', 'mid', 'near']);
  });

  it('panning right keeps what lies ahead and evicts what is left behind', () => {
    const ahead = cand('ahead', 0, 4000, 0);
    const behind = cand('behind', 0, -4000, 0);
    expect(keys(rankHorizon([ahead, behind], still({ vx: 2000 }), cold))).toEqual(['behind', 'ahead']);
    expect(keys(rankHorizon([ahead, behind], still({ vx: -2000 }), cold))).toEqual(['ahead', 'behind']);
  });

  it('zooming in keeps the finer stratum; zooming out drops it first', () => {
    const fine = cand('fine', 0, 0, 0);
    const coarse = cand('coarse', 2, 3000, 0);
    const zoomIn = still({ z: 3, r: 4000, vz: -2 });
    const zoomOut = still({ z: 3, r: 4000, vz: 2 });
    expect(timeToNeed(fine, zoomIn)).toBeLessThan(timeToNeed(fine, zoomOut));
    expect(keys(rankHorizon([fine, coarse], zoomOut, cold))[0]).toBe('fine');
  });

  it('a studied (hot) brush outlasts an equally far cold one', () => {
    const cs = [cand('hot', 0, 6000, 0), cand('cold', 0, -6000, 0)];
    const heat = (k: string): number => (k === 'hot' ? 20 : 0);
    expect(keys(rankHorizon(cs, still(), heat))).toEqual(['cold', 'hot']);
    expect(keys(rankHorizon(cs, still(), heat, { heat: false }))).toHaveLength(2);
  });

  it('ranks before the first view without failing', () => {
    expect(rankHorizon([cand('a', 0, 10, 10)], null, cold)).toHaveLength(1);
  });
});

describe('collectCandidates (fixed §5.2.3 filter)', () => {
  function book(): DeliveryLedger {
    const b = emptyLedger();
    const add = (d: number, s: number, bx: number, by: number): void => {
      b.byDelivery.set(d, {
        delivery: d, brushId: makeBrushId(s, bx, by), stratum: s, from: 0, through: 4, bytes: 1,
        epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    };
    add(1, 7, 0, 0); // sketch
    add(2, 1, 0, 0); // parent of 3
    add(3, 0, 1, 1);
    add(4, 0, 0, 0); // on screen
    add(5, 0, 30, 0); // off screen leaf
    add(6, 0, 30, 0); // same brush, second delivery
    b.childrenOf.set(2, new Set([3]));
    return b;
  }
  const view: EvictView = { x0: 0, y0: 0, x1: 200, y1: 200, focus: 0 };

  it('never offers the sketch, the core, or a brush with owned children; groups deliveries per brush', () => {
    const got = collectCandidates(book(), view, 7);
    expect(got.map((c) => c.recs.map((r) => r.delivery))).toEqual([[3], [5, 6]]);
  });

  it('keeps the periphery rings the server may still be refining: stratum focus + j within F_j', () => {
    const b = emptyLedger();
    const add = (d: number, s: number, bx: number): void => {
      b.byDelivery.set(d, {
        delivery: d, brushId: makeBrushId(s, bx, 0), stratum: s, from: 0, through: 4, bytes: 1,
        epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    };
    add(1, 1, 0); // [0, 512): off screen but inside F_1 = [500, 900)
    add(2, 0, 1); // [256, 512): off screen and outside F_0: evictable
    add(3, 1, 2); // [1024, 1536): outside F_1: evictable
    const offCentre: EvictView = { x0: 600, y0: 0, x1: 800, y1: 200, focus: 0 };
    const got = collectCandidates(b, offCentre, 7);
    expect(got.map((c) => c.recs[0]!.delivery).sort()).toEqual([2, 3]);
  });
});
