import { describe, expect, it } from 'vitest';
import { FrameMeter } from '../frame-meter';

describe('FrameMeter', () => {
  it('asks for motion until it has frame gaps, then reports fps and p95', () => {
    const m = new FrameMeter();
    expect(m.label(3, 9)).toContain('move to measure');
    for (let t = 0; t <= 1000; t += 16) m.frame(t, 2);
    const text = m.label(3, 9);
    expect(text).toMatch(/^6[23] fps · p95 16\.0 ms · paint [\d.]+ ms · draws 3 · loaded 9$/);
  });

  it('ignores idle gaps between gestures', () => {
    const m = new FrameMeter();
    m.frame(0, 1);
    m.frame(5000, 1);
    expect(m.label(0, 0)).toContain('move to measure');
  });
});
