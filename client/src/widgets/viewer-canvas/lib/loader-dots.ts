import {
  LOADER_DOT_BASE_RADIUS, LOADER_DOT_COUNT, LOADER_ORBIT_PULSE, LOADER_ORBIT_PULSE_SPEED, LOADER_ORBIT_RADIUS,
  LOADER_SIZE_PHASE_STEP, LOADER_SIZE_PULSE_SPEED, LOADER_SPEED, TAU,
} from '@/shared/config/render';

/** Calls `dot` for each loader dot at time `t` (s): its index, centre in a `w × h` view, and radius. Allocation-free. */
export function forEachLoaderDot(
  t: number, w: number, h: number, dot: (i: number, x: number, y: number, r: number) => void,
): void {
  for (let i = 0; i < LOADER_DOT_COUNT; i++) {
    const a = t * LOADER_SPEED + i * (TAU / LOADER_DOT_COUNT);
    const orbit = LOADER_ORBIT_RADIUS + LOADER_ORBIT_PULSE * Math.sin(t * LOADER_ORBIT_PULSE_SPEED + i);
    const r = LOADER_DOT_BASE_RADIUS
      + LOADER_DOT_BASE_RADIUS * (0.5 + 0.5 * Math.sin(t * LOADER_SIZE_PULSE_SPEED - i * LOADER_SIZE_PHASE_STEP));
    dot(i, w / 2 + Math.cos(a) * orbit, h / 2 + Math.sin(a) * orbit, r);
  }
}
