/**
 * Script-speed probe (shared/lib/script-speed): a typed-array loop timed against a native sort of
 * the same data. Measured in Chromium, normal and with 6x CPU throttling: loop/sort is 0.1–0.4 with
 * the JIT and 6–10 without it (e.g. a browser security mode that turns it off for the site).
 */
export const SCRIPT_PROBE_LENGTH = 1 << 14;
export const SCRIPT_PROBE_REPS = 20;
export const SCRIPT_PROBE_TRIALS = 3;
/** Loop/sort time ratio at or above which a trial counts as unoptimized (about 4x from both sides). */
export const SCRIPT_SLOW_RATIO = 1.5;
/** Wait after the viewer opens so the probe never competes with the first paint. */
export const SCRIPT_PROBE_DELAY_MS = 2000;
