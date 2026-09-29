import {
  BYTES_PER_KIB, EVICT_HEADROOM, EVICT_PRESSURE, EVICT_TARGET, MS_PER_S, ReleaseReason, SKETCH_MIN,
} from '@/shared/config/constants';
import { collectCandidates, inCone, inCore, ownedBrushes, type EvictCandidate } from '../evict-candidate';
import { rankHorizon } from '../horizon-rank';
import { heldBrushes, ownedBytes } from '../store';
import { coreMissing } from './core-deficit';
import { byteWindow } from './credit-window';
import { release } from './release';
import { removeSubtree } from './removal';
import { holdLimit, type SinkState } from './state';

/** Attention heat: the brushes the outgoing view showed are credited the time it stayed on screen. */
export function warmShown(s: SinkState, nowS: number): void {
  const v = s.view;
  if (!v) return;
  const dwell = nowS - s.viewSince;
  for (const [key, recs] of ownedBrushes(s.book)) {
    if (inCore(v, recs[0]!.brushId)) s.heat.warm(key, dwell, nowS);
  }
}

/**
 * §5.2.3 voluntary eviction. Under pressure (brushes held >= max - 8, counted per brush+edition however
 * many deliveries it took, bytes > 90 %, or room in max_kib for fewer than 8 more after what may still come)
 * drop leaf brushes (no owned children) outside the current cone until 75 % full with room for 8, then in-cone ones only
 * while core brushes are missing. Never the sketch nor the core, and not a cone the server may
 * still be painting unless the book is full (see `collectCandidates`). Order is Horizon (`rankHorizon`): the largest predicted time-to-need
 * from the gaze's motion (kinematic Belady), shortened by attention heat.
 * Whole brushes go, all deliveries at once, with SOLTAR reason 1.
 */
export function relieve(s: SinkState, vramShort = false): boolean {
  const { book } = s;
  const load = (): number => heldBrushes(book);
  const maxKib = s.limits.maxKiB() * BYTES_PER_KIB;
  // A failed VRAM reservation is pressure whatever the counts say: relieve to 75 % of what is held.
  const hold = holdLimit(s);
  const maxN = vramShort ? Math.min(hold, load()) : hold;
  const maxB = vramShort ? Math.min(maxKib, ownedBytes(book)) : maxKib;
  // The byte window closes RECIBO.libre (`free`): pressure must see it too, or the view stalls at 0.
  const cramped = (): boolean => !vramShort && byteWindow(s) < EVICT_HEADROOM;
  if (!vramShort && !cramped() && load() < maxN - EVICT_HEADROOM && ownedBytes(book) <= EVICT_PRESSURE * maxB) {
    return false;
  }
  const sketch = Math.min(SKETCH_MIN, Math.max(0, s.top - 1));
  const nowS = performance.now() / MS_PER_S;
  const gaze = s.gaze.state(nowS);
  const heatOf = (key: string): number => s.heat.heat(key, nowS);
  const released: number[] = [];
  const over = (): boolean => cramped() || load() > EVICT_TARGET * maxN || ownedBytes(book) > EVICT_TARGET * maxB;
  // The server opens a flow only while |libro| < max_pinceladas (§4.1 c), so with the book full
  // nothing is on the wire: only the core stays (§5.2.3), and a cone larger than the
  // concession cannot stall the view with nothing evictable. Bytes do not stop the server: a cone
  // it may still paint keeps its parents, or its children arrive to find them gone (spec 5.4).
  const held = (m: number): boolean => book.byDelivery.has(m);
  const painted = heldBrushes(book) >= hold ? []
    : s.cones.views((n) => s.settlement.settledBelow(n, held));
  const evict = (more: () => boolean, allowed: (c: EvictCandidate) => boolean): void => {
    while (more()) {
      const candidates = collectCandidates(book, s.view, painted, sketch).filter(allowed);
      if (candidates.length === 0) break;
      for (const { recs } of rankHorizon(candidates, gaze, heatOf)) {
        if (!more()) break;
        for (const r of recs) if (held(r.delivery)) released.push(...removeSubtree(s, r.delivery, 0, 'evicted'));
      }
    }
  };
  // Outside the current cone first (§5.2.3); a failed VRAM reservation sheds whatever it must.
  evict(over, (c) => vramShort || !inCone(s.view, c.recs[0]!.brushId));
  // The cone's own rings only make room for a missing core, a few at a time: evicting more would
  // be re-sent by the next plan. A full book otherwise stays full: libre is 0 and the server waits.
  const room = (): number => Math.min(hold - load(), byteWindow(s));
  if (!vramShort && room() < EVICT_HEADROOM) {
    const need = Math.min(EVICT_HEADROOM, coreMissing(s));
    evict(() => room() < need, () => true);
  }
  if (released.length > 0) s.heat.prune(new Set(ownedBrushes(book).keys()));
  release(s, released, ReleaseReason.EVICTED);
  return released.length > 0;
}
