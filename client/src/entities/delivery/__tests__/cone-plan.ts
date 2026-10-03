import { TILE } from '@/shared/config/constants';
import { GazeMotion, type GazeState } from '../gaze-motion';
import { timeToNeed } from '../horizon-rank';
import type { EvictCandidate, EvictView } from '../evict-candidate';
import { IMAGE_PX, SIM, tilesIn } from './eviction-sim';

/**
 * Plans for the flow bench. `simplePlanner` is the ADR-08 bench's cone; `conePlanner` follows the
 * server's ConePlanner: focus tiles at their bands, ancestors whole, ring 1 (×2) at focus + 1 with
 * 2 bands, ring 2 (×4) at focus + 2 with 1 band, the ancestors of every ring brush, then the three
 * passes (core up to 2 bands, core the rest, rings) each coarse first and nearest first.
 */
export const BANDS = 4;
const KIB = 1024;
const TOP = SIM.levels - 1;

export const key = (s: number, bx: number, by: number): string => `${s}/${bx}/${by}`;

/** 8..64 KiB for all four bands, fixed per brush. */
export function sizeOf(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return (8 + ((h >>> 0) % 57)) * KIB;
}

/** One plan entry: bring `tile` up to `to` bands. */
export interface PlanItem { tile: string; to: number }
/** A view's plan in send order; `core`: its focus tiles; `seen`: those and their ancestors (what the screen draws from). */
export interface Cone { items: PlanItem[]; core: string[]; seen: string[] }
/** A planner sees every MIRADA in order; `quiet`: the QUIETA copy of a view that stopped. */
export interface Planner { plan(v: EvictView, tS: number, quiet: boolean): Cone }

function ancestry(s: number, bx: number, by: number): string[] {
  const out: string[] = [];
  for (let k = s; k <= TOP; k++) out.push(key(k, bx >> (k - s), by >> (k - s)));
  return out;
}

function seenOf(focus: number, tiles: Array<[number, number]>): string[] {
  return [...new Set(tiles.flatMap(([bx, by]) => ancestry(focus, bx, by)))];
}

/** The ADR-08 bench's cone: core tiles nearest first, each after its ancestors, then the 2× ring, all bands. */
export function simplePlanner(): Planner {
  return {
    plan(v) {
      const out = new Set<string>();
      const tiles = tilesIn(v, v.focus, 1);
      for (const [bx, by] of tiles) for (const k of ancestry(v.focus, bx, by).reverse()) out.add(k);
      for (const [bx, by] of tilesIn(v, v.focus, SIM.ring)) out.add(key(v.focus, bx, by));
      return {
        items: [...out].map((tile) => ({ tile, to: BANDS })),
        core: tiles.map(([bx, by]) => key(v.focus, bx, by)),
        seen: seenOf(v.focus, tiles),
      };
    },
  };
}

function boxTiles(s: number, x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const side = TILE * 2 ** s;
  const n = Math.ceil(IMAGE_PX / side);
  const out: Array<[number, number]> = [];
  for (let by = Math.max(0, Math.floor(y0 / side)); by <= Math.min(n - 1, Math.ceil(y1 / side) - 1); by++) {
    for (let bx = Math.max(0, Math.floor(x0 / side)); bx <= Math.min(n - 1, Math.ceil(x1 / side) - 1); bx++) out.push([bx, by]);
  }
  return out;
}

const clamp = (x: number, lim: number): number => Math.max(-lim, Math.min(lim, x));

/** Ring shifts along the pan: ring 1 by v·τ1 within the focus, ring 2 by v·τ2 within ring 1. */
export function leads(g: GazeState, hw: number, hh: number, tau: readonly [number, number]): [number, number, number, number] {
  const x1 = clamp(g.vx * tau[0], hw);
  const y1 = clamp(g.vy * tau[0], hh);
  return [x1, y1, x1 + clamp(g.vx * tau[1] - x1, 2 * hw), y1 + clamp(g.vy * tau[1] - y1, 2 * hh)];
}

/** Ring leads of the ADR-10 proposal: ring 1 by v · 0.5 s, ring 2 by v · 1 s. */
const LEAD_S = [0.5, 1] as const;

export interface ConeOpts { lead: boolean; ttn: boolean }

export function conePlanner(o: ConeOpts): () => Planner {
  return () => {
    let gaze = new GazeMotion();
    return {
      plan(v, tS, quiet) {
        const cx = (v.x0 + v.x1) / 2;
        const cy = (v.y0 + v.y1) / 2;
        const hw = (v.x1 - v.x0) / 2;
        const hh = (v.y1 - v.y0) / 2;
        const z = Math.log2((2 * hw) / SIM.screenW);
        if (quiet) gaze = new GazeMotion(); // QUIETA: the view stopped, velocity is zero
        gaze.observe(tS, cx, cy, z, Math.hypot(hw, hh));
        const g = gaze.state(tS)!;
        const [s1x, s1y, s2x, s2y] = o.lead ? leads(g, hw, hh, LEAD_S) : [0, 0, 0, 0];
        const phi = z <= 0 ? 0 : z - v.focus;
        const want = new Map<string, { s: number; bx: number; by: number; to: number }>();
        const put = (s: number, bx: number, by: number, to: number): void => {
          const k = key(s, bx, by);
          const w = want.get(k);
          if (!w) want.set(k, { s, bx, by, to });
          else w.to = Math.max(w.to, to);
        };
        const focus = boxTiles(v.focus, v.x0, v.y0, v.x1, v.y1);
        const core = new Set(seenOf(v.focus, focus));
        for (const [bx, by] of focus) put(v.focus, bx, by, Math.max(1, BANDS - Math.floor(BANDS * phi)));
        for (const k of core) if (!k.startsWith(`${v.focus}/`)) { const [s, bx, by] = k.split('/').map(Number); put(s!, bx!, by!, BANDS); }
        const ring = (j: number, sx: number, sy: number, to: number): void => {
          if (v.focus + j >= TOP) return;
          const k = 2 ** j;
          for (const [bx, by] of boxTiles(v.focus + j, cx + sx - hw * k, cy + sy - hh * k, cx + sx + hw * k, cy + sy + hh * k)) put(v.focus + j, bx, by, to);
        };
        ring(1, s1x, s1y, 2);
        ring(2, s2x, s2y, 1);
        for (let s = 0; s < TOP; s++) {
          for (const w of [...want.values()]) if (w.s === s) put(s + 1, w.bx >> 1, w.by >> 1, w.to);
        }
        const rank = (w: { s: number; bx: number; by: number }, pass3: boolean): number => {
          const side = TILE * 2 ** w.s;
          const c = { key: '', recs: [], stratum: w.s, cx: (w.bx + 0.5) * side, cy: (w.by + 0.5) * side, side } as EvictCandidate;
          return pass3 && o.ttn ? timeToNeed(c, g) : Math.hypot(c.cx - cx, c.cy - cy);
        };
        const passes: Array<Array<{ s: number; bx: number; by: number; to: number; r: number; d: number }>> = [[], [], []];
        for (const [k, w] of want) {
          const d = rank(w, false);
          if (core.has(k)) {
            passes[0]!.push({ ...w, to: Math.min(w.to, 2), r: d, d });
            if (w.to > 2) passes[1]!.push({ ...w, r: d, d });
          } else passes[2]!.push({ ...w, r: rank(w, true), d });
        }
        for (const p of passes) p.sort((a, b) => b.s - a.s || a.r - b.r || a.d - b.d || a.by - b.by || a.bx - b.bx);
        return {
          items: passes.flat().map((w) => ({ tile: key(w.s, w.bx, w.by), to: w.to })),
          core: focus.map(([bx, by]) => key(v.focus, bx, by)),
          seen: [...core],
        };
      },
    };
  };
}
