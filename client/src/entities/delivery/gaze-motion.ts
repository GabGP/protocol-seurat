import { GAZE_ALPHA, GAZE_BETA, GAZE_STALE_S, GAZE_VELOCITY_HALF_LIFE_S } from '@/shared/config/constants';

/** Where the gaze is (last view) and how fast it moves: x, y in image px/s, z in levels/s. */
export interface GazeState {
  x: number;
  y: number;
  /** log2(image px per screen px): the continuous zoom level. */
  z: number;
  /** View half-diagonal in image px. */
  r: number;
  vx: number;
  vy: number;
  vz: number;
}

interface Axis {
  p: number;
  v: number;
}

/**
 * α-β filter over the views the last MIRADAs described. Position is smoothed only to estimate
 * velocity; `state()` reports the last measured view, so the on-screen core stays exact.
 */
export class GazeMotion {
  private axes: [Axis, Axis, Axis] | null = null;
  private last: { t: number; x: number; y: number; z: number; r: number } | null = null;

  observe(tS: number, x: number, y: number, z: number, r: number): void {
    const dt = this.last ? tS - this.last.t : Infinity;
    this.last = { t: tS, x, y, z, r };
    if (!this.axes || dt > GAZE_STALE_S) {
      this.axes = [{ p: x, v: 0 }, { p: y, v: 0 }, { p: z, v: 0 }];
      return;
    }
    if (dt <= 0) return;
    const meas = [x, y, z] as const;
    this.axes.forEach((a, i) => {
      const predicted = a.p + a.v * dt;
      const residual = meas[i]! - predicted;
      a.p = predicted + GAZE_ALPHA * residual;
      a.v += (GAZE_BETA / dt) * residual;
    });
  }

  /** The gaze at `nowS`: velocity fades once views stop arriving (the user stopped moving). */
  state(nowS: number): GazeState | null {
    const l = this.last;
    const a = this.axes;
    if (!l || !a) return null;
    const fade = 0.5 ** (Math.max(0, nowS - l.t) / GAZE_VELOCITY_HALF_LIFE_S);
    return { x: l.x, y: l.y, z: l.z, r: l.r, vx: a[0].v * fade, vy: a[1].v * fade, vz: a[2].v * fade };
  }
}
