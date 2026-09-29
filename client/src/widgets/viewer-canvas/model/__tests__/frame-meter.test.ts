import { describe, expect, it } from 'vitest';
import { FrameMeter } from '../frame-meter';

/** The readout with its non-breaking spaces shown as plain ones. */
const plain = (s: string): string => s.replace(/ /g, ' ');

describe('FrameMeter', () => {
  it('holds placeholders until it has frame gaps, then reports fps and p95', () => {
    const m = new FrameMeter();
    expect(plain(m.label(3, 9))).toMatch(/^  — fps · p95     — ms · paint +0\.0 ms · draws    3 · loaded    9$/);
    for (let t = 0; t <= 1000; t += 16) m.frame(t, 2);
    const text = plain(m.label(3, 9));
    expect(text).toMatch(/^ 6[23] fps · p95  16\.0 ms · paint +[\d.]+ ms · draws    3 · loaded    9$/);
  });

  it('keeps one width while measuring and as the numbers grow', () => {
    const m = new FrameMeter();
    const idle = m.label(3, 9).length;
    for (let t = 0; t <= 1000; t += 16) m.frame(t, 2);
    expect(m.label(3, 9).length).toBe(idle);
    expect(m.label(1234, 5678).length).toBe(idle);
  });

  it('never breaks inside a part, only between them', () => {
    const parts = new FrameMeter().label(1, 2).split(' · ');
    expect(parts).toHaveLength(5);
    expect(parts.some((p) => p.includes(' '))).toBe(false);
  });

  it('ignores idle gaps between gestures', () => {
    const m = new FrameMeter();
    m.frame(0, 1);
    m.frame(5000, 1);
    expect(plain(m.label(0, 0))).toMatch(/^ +— fps/);
  });

  it('names the active renderer first when given', () => {
    expect(plain(new FrameMeter().label(1, 2, 'webgl2'))).toMatch(/^webgl2 · +— fps/);
  });
});
