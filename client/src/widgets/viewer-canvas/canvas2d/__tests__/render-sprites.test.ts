import { describe, expect, it } from 'vitest';
import { frameShadowSlices } from '../render-sprites';

describe('frameShadowSlices (9-slice frame shadow)', () => {
  const R = 10; // reach

  it('tiles the rect grown by reach, minus the centre, with no gaps or overlaps', () => {
    const slices = frameShadowSlices(100, 50, 300, 200, R);
    expect(slices).not.toBeNull();
    const s = slices ?? [];
    expect(s).toHaveLength(8);
    const area = s.reduce((a, [, , , , , , dw, dh]) => a + dw * dh, 0);
    const outer = (300 + 2 * R) * (200 + 2 * R);
    const centre = (300 - 2 * R) * (200 - 2 * R);
    expect(area).toBe(outer - centre);
    const xs = s.map(([, , , , dx]) => dx);
    const ys = s.map(([, , , , , dy]) => dy);
    expect(Math.min(...xs)).toBe(100 - R);
    expect(Math.min(...ys)).toBe(50 - R);
  });

  it('draws corners 1:1 from the sprite and stretches only the 2px middle', () => {
    const s = frameShadowSlices(0, 0, 300, 200, R) ?? [];
    for (const [, , sw, sh, , , dw, dh] of s) {
      expect(sw === 2 ? true : dw === sw).toBe(true);
      expect(sh === 2 ? true : dh === sh).toBe(true);
    }
  });

  it('refuses rects too small for the corners (caller blurs those directly)', () => {
    expect(frameShadowSlices(0, 0, 2 * R - 1, 100, R)).toBeNull();
    expect(frameShadowSlices(0, 0, 100, 2 * R - 1, R)).toBeNull();
  });
});
