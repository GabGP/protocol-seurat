import { describe, expect, it } from 'vitest';
import { FrameMeter } from '../frame-meter';

/** The readout with its non-breaking spaces shown as plain ones. */
const plain = (s: string): string => s.replace(/ /g, ' ');

describe('FrameMeter', () => {
  it('holds placeholders until it has frame gaps, then reports fps, mean and p95 frame time', () => {
    const m = new FrameMeter();
    expect(plain(m.label())).toBe('  — fps · mean     — ms · p95     — ms');
    for (let t = 0; t <= 1000; t += 16) m.frame(t);
    expect(plain(m.label())).toMatch(/^ 6[23] fps · mean  16\.0 ms · p95  16\.0 ms$/);
  });

  it('shows no paint CPU, draw or loaded counts', () => {
    const m = new FrameMeter();
    for (let t = 0; t <= 1000; t += 16) m.frame(t);
    expect(plain(m.label('webgl2'))).not.toMatch(/paint|draws|loaded/);
  });

  it('keeps one width while measuring', () => {
    const m = new FrameMeter();
    const idle = m.label().length;
    for (let t = 0; t <= 1000; t += 16) m.frame(t);
    expect(m.label().length).toBe(idle);
  });

  it('never breaks inside a part, only between them', () => {
    const parts = new FrameMeter().label().split(' · ');
    expect(parts).toHaveLength(3);
    expect(parts.some((p) => p.includes(' '))).toBe(false);
  });

  it('ignores idle gaps between gestures', () => {
    const m = new FrameMeter();
    m.frame(0);
    m.frame(5000);
    expect(plain(m.label())).toMatch(/^ +— fps/);
  });

  it('names the active renderer first, exactly as given', () => {
    expect(plain(new FrameMeter().label('webgl2'))).toMatch(/^webgl2 · +— fps/);
    expect(plain(new FrameMeter().label('canvas2d'))).toMatch(/^canvas2d · +— fps/);
  });
});
