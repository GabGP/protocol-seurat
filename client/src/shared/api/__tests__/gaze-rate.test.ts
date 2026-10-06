import { describe, expect, it } from 'vitest';
import { GAZE_PER_S, MS_PER_S } from '../../config/constants';
import { GazeRate } from '../gaze-rate';

describe('GazeRate', () => {
  it('allows GAZE_PER_S at one instant, refuses the next, and allows again after one second', () => {
    const rate = new GazeRate();
    const t0 = 1000;
    for (let i = 0; i < GAZE_PER_S; i++) {
      expect(rate.allow(t0)).toBe(true);
    }
    expect(rate.allow(t0)).toBe(false);
    expect(rate.allow(t0 + MS_PER_S - 1)).toBe(false);
    expect(rate.allow(t0 + MS_PER_S)).toBe(true);
  });
});
