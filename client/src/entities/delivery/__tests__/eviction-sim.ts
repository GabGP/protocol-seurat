import { EVICT_HEADROOM, EVICT_TARGET, LEASE_S, TILE } from '@/shared/config/constants';
import { brushKey, makeBrushId } from '@/shared/proto/brush';
import { AttentionHeat } from '../attention-heat';
import { collectCandidates, inCore, ownedBrushes, type EvictCandidate, type EvictView } from '../evict-candidate';
import { GazeMotion, type GazeState } from '../gaze-motion';
import { emptyLedger, type DeliveryLedger } from '../store';

/**
 * Deterministic replay of a gaze trace against a bounded brush book, using the real §5.2.3
 * filter (`collectCandidates`), gaze filter and attention heat. Only the ranker varies.
 * Model: 20 MIRADA/s; what is on screen is fetched at once (a miss = a stall the user sees);
 * the server prefetches the ring around the view up to the eviction target; leases are renewed
 * each second for the view + ring and expire after LEASE_S.
 */
export const SIM = {
  levels: 9, // strata 0..8, one tile at the top
  sketch: 7,
  screenW: 1024,
  screenH: 768,
  stepS: 0.05,
  ring: 2,
  renewEveryS: 1,
} as const;

export const IMAGE_PX = TILE * 2 ** (SIM.levels - 1);

export interface Frame {
  x: number;
  y: number;
  z: number;
}

export interface RankContext {
  view: EvictView;
  gaze: GazeState | null;
  heatOf: (key: string) => number;
}

export type Ranker = (cands: EvictCandidate[], ctx: RankContext) => EvictCandidate[];

export interface SimResult {
  stalls: number;
  fetched: number;
  evicted: number;
}

function viewOf(f: Frame): EvictView {
  const scale = 2 ** f.z;
  const hw = (SIM.screenW / 2) * scale;
  const hh = (SIM.screenH / 2) * scale;
  const focus = Math.max(0, Math.min(SIM.levels - 2, Math.floor(f.z)));
  return { x0: f.x - hw, y0: f.y - hh, x1: f.x + hw, y1: f.y + hh, focus };
}

/** Tiles of `stratum` overlapping the view grown `grow`× about its centre, nearest first. */
function tilesIn(v: EvictView, stratum: number, grow: number): Array<[number, number]> {
  const side = TILE * 2 ** stratum;
  const n = Math.ceil(IMAGE_PX / side);
  const cx = (v.x0 + v.x1) / 2;
  const cy = (v.y0 + v.y1) / 2;
  const hw = ((v.x1 - v.x0) / 2) * grow;
  const hh = ((v.y1 - v.y0) / 2) * grow;
  const lo = (p: number): number => Math.max(0, Math.floor(p / side));
  const hi = (p: number): number => Math.min(n - 1, Math.ceil(p / side) - 1);
  const out: Array<[number, number]> = [];
  for (let by = lo(cy - hh); by <= hi(cy + hh); by++) {
    for (let bx = lo(cx - hw); bx <= hi(cx + hw); bx++) out.push([bx, by]);
  }
  const d = ([bx, by]: [number, number]): number => Math.hypot((bx + 0.5) * side - cx, (by + 0.5) * side - cy);
  return out.sort((a, b) => d(a) - d(b));
}

class SimBook {
  readonly book: DeliveryLedger = emptyLedger();
  private readonly byKey = new Map<string, number>();
  private next = 1;
  fetched = 0;

  get size(): number {
    return this.book.byDelivery.size;
  }

  has(s: number, bx: number, by: number): boolean {
    return this.byKey.has(brushKey(makeBrushId(s, bx, by), 1));
  }

  /** Fetch a brush, ancestors first (the book stays ancestor-closed). */
  fetch(s: number, bx: number, by: number, nowMs: number): number {
    const key = brushKey(makeBrushId(s, bx, by), 1);
    const have = this.byKey.get(key);
    if (have !== undefined) return have;
    const parent = s + 1 < SIM.levels ? this.fetch(s + 1, bx >> 1, by >> 1, nowMs) : undefined;
    const delivery = this.next++;
    this.book.byDelivery.set(delivery, {
      delivery, brushId: makeBrushId(s, bx, by), stratum: s, from: 0, through: 4, bytes: 1,
      epoch: 1, edition: 1, expires: nowMs + LEASE_S * 1000, rgba: null,
    });
    this.byKey.set(key, delivery);
    this.fetched++;
    if (parent !== undefined) {
      this.book.parentOf.set(delivery, parent);
      const kids = this.book.childrenOf.get(parent) ?? new Set<number>();
      kids.add(delivery);
      this.book.childrenOf.set(parent, kids);
    }
    return delivery;
  }

  remove(delivery: number): void {
    for (const kid of [...(this.book.childrenOf.get(delivery) ?? [])]) this.remove(kid);
    const rec = this.book.byDelivery.get(delivery);
    if (!rec) return;
    this.book.byDelivery.delete(delivery);
    this.byKey.delete(brushKey(rec.brushId, rec.edition));
    const parent = this.book.parentOf.get(delivery);
    if (parent !== undefined) this.book.childrenOf.get(parent)?.delete(delivery);
    this.book.parentOf.delete(delivery);
    this.book.childrenOf.delete(delivery);
  }

  renew(s: number, bx: number, by: number, until: number): void {
    const d = this.byKey.get(brushKey(makeBrushId(s, bx, by), 1));
    const rec = d === undefined ? undefined : this.book.byDelivery.get(d);
    if (rec) rec.expires = until;
  }

  sweep(nowMs: number): void {
    for (const [d, rec] of [...this.book.byDelivery]) if (rec.expires <= nowMs) this.remove(d);
  }
}

function ancestry(s: number, bx: number, by: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let k = s; k < SIM.levels; k++) out.push([k, bx >> (k - s), by >> (k - s)]);
  return out;
}

/** `cap` = max_pinceladas: 128 is the spec's no-API default, 256 a Chromium desktop. */
export function simulate(trace: readonly Frame[], rank: Ranker, cap: number): SimResult {
  const sim = new SimBook();
  const gaze = new GazeMotion();
  const heat = new AttentionHeat();
  let stalls = 0;
  let evicted = 0;
  let prev: EvictView | null = null;
  const relieve = (v: EvictView, tS: number): void => {
    if (sim.size < cap - EVICT_HEADROOM) return;
    while (sim.size > EVICT_TARGET * cap) {
      const cands = collectCandidates(sim.book, v, [v], SIM.sketch);
      if (cands.length === 0) break;
      const ctx = { view: v, gaze: gaze.state(tS), heatOf: (k: string) => heat.heat(k, tS) };
      for (const c of rank(cands, ctx)) {
        if (sim.size <= EVICT_TARGET * cap) break;
        for (const r of c.recs) sim.remove(r.delivery);
        evicted++;
      }
    }
    heat.prune(new Set(ownedBrushes(sim.book).keys()));
  };
  trace.forEach((f, i) => {
    const tS = i * SIM.stepS;
    const nowMs = tS * 1000;
    const v = viewOf(f);
    if (prev) {
      for (const [key, recs] of ownedBrushes(sim.book)) if (inCore(prev, recs[0]!.brushId)) heat.warm(key, SIM.stepS, tS);
    }
    gaze.observe(tS, f.x, f.y, f.z, Math.hypot(v.x1 - v.x0, v.y1 - v.y0) / 2);
    relieve(v, tS);
    sim.sweep(nowMs);
    for (const [bx, by] of tilesIn(v, v.focus, 1)) {
      for (const [s, ax, ay] of ancestry(v.focus, bx, by)) {
        if (sim.has(s, ax, ay)) continue;
        stalls++;
        sim.fetch(s, ax, ay, nowMs);
      }
    }
    const ring = tilesIn(v, v.focus, SIM.ring);
    if (i % Math.round(SIM.renewEveryS / SIM.stepS) === 0) {
      for (const [bx, by] of ring) for (const [s, ax, ay] of ancestry(v.focus, bx, by)) sim.renew(s, ax, ay, nowMs + LEASE_S * 1000);
    }
    for (const [bx, by] of ring) {
      if (sim.size >= EVICT_TARGET * cap) break;
      sim.fetch(v.focus, bx, by, nowMs);
    }
    relieve(v, tS);
    prev = v;
  });
  return { stalls, fetched: sim.fetched, evicted };
}
