import {
  SCRIPT_PROBE_LENGTH, SCRIPT_PROBE_REPS, SCRIPT_PROBE_TRIALS, SCRIPT_SLOW_RATIO,
} from '@/shared/config/script-speed';

/**
 * Whether plain JavaScript runs without an optimizing compiler here. A loop over a typed array is
 * timed against a native sort of the same data: a slow machine slows both, a missing JIT only the
 * loop. Any trial under the threshold ends it (the common case costs one trial); a sort the timer
 * cannot see (coarsened clocks) answers false rather than guess.
 */
export function scriptLooksUnoptimized(now: () => number = () => performance.now()): boolean {
  const a = new Float64Array(SCRIPT_PROBE_LENGTH);
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(i);
  for (let t = 0; t < SCRIPT_PROBE_TRIALS; t++) {
    const t0 = now();
    let x = 0;
    for (let r = 0; r < SCRIPT_PROBE_REPS; r++) for (let i = 0; i < a.length; i++) x += a[i]!;
    const t1 = now();
    a.slice().sort();
    const t2 = now();
    if (Number.isNaN(x) || t2 - t1 <= 0) return false; // reading x keeps the loop from being dropped
    if ((t1 - t0) / (t2 - t1) < SCRIPT_SLOW_RATIO) return false;
  }
  return true;
}
