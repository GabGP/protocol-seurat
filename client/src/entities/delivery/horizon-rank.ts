import { HEAT_GAIN, HORIZON_FLOOR, HORIZON_PAN_REF, HORIZON_ZOOM_REF, TILE } from '@/shared/config/constants';
import type { EvictCandidate } from './evict-candidate';
import type { GazeState } from './gaze-motion';

/** Which Horizon terms are on. The policy uses both; kinematics alone exists to measure heat's share. */
export interface HorizonTerms {
  heat: boolean;
}

export const HORIZON_FULL: HorizonTerms = { heat: true };

/** Before the first view: a still gaze at the origin, one tile wide, at native zoom. */
const NO_GAZE: GazeState = { x: 0, y: 0, z: 0, r: TILE, vx: 0, vy: 0, vz: 0 };

/**
 * Kinematic Bélády: predicted seconds until the gaze needs this brush again.
 * Spatial: gap between the view and the brush ÷ closing speed (reference pan + approach velocity).
 * Scale: a brush finer than the view is shown only after zooming in to it ÷ closing zoom speed.
 * Both gaps must close before reuse, so the later one decides.
 */
export function timeToNeed(c: EvictCandidate, g: GazeState): number {
  const dx = c.cx - g.x;
  const dy = c.cy - g.y;
  const dist = Math.hypot(dx, dy);
  const gap = Math.max(0, dist - g.r - c.side / 2);
  const approach = dist > 0 ? (g.vx * dx + g.vy * dy) / dist : 0;
  const panRef = HORIZON_PAN_REF * g.r;
  const spatial = gap / Math.max(panRef * HORIZON_FLOOR, panRef + approach);
  const levels = Math.max(0, g.z - c.stratum - 1);
  const scale = levels / Math.max(HORIZON_ZOOM_REF * HORIZON_FLOOR, HORIZON_ZOOM_REF - g.vz);
  return Math.max(spatial, scale);
}

/**
 * Horizon eviction order, first to evict first: the largest predicted time-to-need, shortened by
 * attention heat (places the user studied are likelier to be revisited). `heatOf` is evaluated at now.
 */
export function rankHorizon(
  cands: readonly EvictCandidate[],
  gaze: GazeState | null,
  heatOf: (key: string) => number,
  terms: HorizonTerms = HORIZON_FULL,
): EvictCandidate[] {
  const g = gaze ?? NO_GAZE;
  const scored = cands.map((c) => ({ c, t: timeToNeed(c, g) / (terms.heat ? 1 + HEAT_GAIN * heatOf(c.key) : 1) }));
  scored.sort((a, b) => b.t - a.t);
  return scored.map((s) => s.c);
}
