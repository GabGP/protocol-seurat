import { describe, expect, it } from 'vitest';
import { scriptLooksUnoptimized } from '../script-speed';
import { SCRIPT_PROBE_TRIALS, SCRIPT_SLOW_RATIO } from '@/shared/config/script-speed';

/** A clock that answers the given readings in order (three per trial: start, loop end, sort end). */
function clock(readings: number[]): { now: () => number; reads: () => number } {
  let i = 0;
  return { now: () => readings[i++] ?? 0, reads: () => i };
}

/** One trial whose loop took `loop` ms and whose sort took `sort` ms, starting at `at`. */
const trial = (at: number, loop: number, sort: number): number[] => [at, at + loop, at + loop + sort];

describe('scriptLooksUnoptimized', () => {
  it('answers true only when every trial is slow', () => {
    const slow = SCRIPT_SLOW_RATIO * 4;
    const c = clock(Array.from({ length: SCRIPT_PROBE_TRIALS }, (_, t) => trial(t * 100, slow, 1)).flat());
    expect(scriptLooksUnoptimized(c.now)).toBe(true);
    expect(c.reads()).toBe(SCRIPT_PROBE_TRIALS * 3);
  });

  it('stops at the first fast trial', () => {
    const c = clock([...trial(0, SCRIPT_SLOW_RATIO * 4, 1), ...trial(100, SCRIPT_SLOW_RATIO / 4, 1)]);
    expect(scriptLooksUnoptimized(c.now)).toBe(false);
    expect(c.reads()).toBe(6);
  });

  it('does not guess when the timer cannot see the sort', () => {
    const c = clock(trial(0, 16, 0));
    expect(scriptLooksUnoptimized(c.now)).toBe(false);
    expect(c.reads()).toBe(3);
  });

  it('reports an optimizing engine as optimized', () => {
    expect(scriptLooksUnoptimized()).toBe(false); // Node runs with its JIT
  });
});
