import { describe, expect, it } from 'vitest';
import { ARRIVAL_MIN_SAMPLES } from '@/shared/config/constants';
import { ArrivalRate } from '../arrival-rate';

describe('ArrivalRate', () => {
  it('returns 0 before ARRIVAL_MIN_SAMPLES gaps', () => {
    const rate = new ArrivalRate();
    rate.note(26_000, 1000);
    expect(rate.bps()).toBe(0);
    for (let i = 1; i < ARRIVAL_MIN_SAMPLES; i++) {
      rate.note(26_000, 1000 + i * 800);
      expect(rate.bps()).toBe(0);
    }
  });

  it('reads 32 500 B/s for 26 000 B every 800 ms with exactly ARRIVAL_MIN_SAMPLES', () => {
    const rate = new ArrivalRate();
    rate.note(26_000, 1000);
    for (let i = 1; i <= ARRIVAL_MIN_SAMPLES; i++) {
      rate.note(26_000, 1000 + i * 800);
    }
    expect(rate.bps()).toBe(32_500);
  });

  it('does not move the median with one idle 5 s gap among 16', () => {
    const rate = new ArrivalRate();
    let t = 1000;
    rate.note(26_000, t);
    for (let i = 0; i < 15; i++) {
      t += 800;
      rate.note(26_000, t);
    }
    t += 5000;
    rate.note(26_000, t);
    expect(rate.bps()).toBe(32_500);
  });

  it('adds nothing on zero or negative gaps and non-positive bytes', () => {
    const rate = new ArrivalRate();
    rate.note(26_000, 1000);
    for (let i = 1; i < ARRIVAL_MIN_SAMPLES; i++) {
      rate.note(26_000, 1000 + i * 800);
    }
    expect(rate.bps()).toBe(0);
    rate.note(26_000, 1000 + 7 * 800); // 0 gap
    rate.note(0, 1000 + 8 * 800); // 0 bytes
    rate.note(-500, 1000 + 9 * 800); // negative bytes
    expect(rate.bps()).toBe(0);
    rate.note(26_000, 1000 + 10 * 800);
    expect(rate.bps()).toBe(32_500);
  });
});
