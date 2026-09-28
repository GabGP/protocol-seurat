import { describe, expect, it } from 'vitest';
import { bandsFor, idealDensity, strataFor, viewToRoi } from '@/entities/viewport/math';

describe('viewport density math (spec 2.2)', () => {
  it('spec 3.4.2 view gives ideal 1, s 1, phi 0, 4 bands', () => {
    const ideal = idealDensity({ x0: 65536, y0: 49152, x1: 69376, y1: 51312 }, { vw: 1920, vh: 1080 });
    expect(ideal).toBeCloseTo(1, 10);
    const { s, phi } = strataFor(ideal, 10);
    expect(s).toBe(1);
    expect(phi).toBeCloseTo(0, 10);
    expect(bandsFor(phi)).toBe(4);
  });
  it('bands follow phi quarters', () => {
    expect(bandsFor(0)).toBe(4);
    expect(bandsFor(0.3)).toBe(3);
    expect(bandsFor(0.6)).toBe(2);
    expect(bandsFor(0.9)).toBe(1);
  });
  it('ideal <= 0 pins to s 0', () => {
    expect(strataFor(-0.5, 10)).toEqual({ s: 0, phi: 0 });
    expect(strataFor(99, 10)).toEqual({ s: 10, phi: 0 });
  });
});

describe('viewToRoi', () => {
  const vp = { vw: 800, vh: 600 };

  it('clips a view that overlaps the image to the image', () => {
    expect(viewToRoi(2, -100, 50, vp, 1000, 1000)).toEqual({ x0: 50, y0: 0, x1: 450, y1: 275 });
  });

  it('never inverts the rectangle when the image is dragged off screen (MIRADA would be fatal)', () => {
    for (const [tx, ty] of [[900, 0], [-5000, 0], [0, 700], [0, -5000], [-5000, -5000]] as const) {
      const r = viewToRoi(2, tx, ty, vp, 1000, 1000);
      expect(r.x1).toBeGreaterThan(r.x0);
      expect(r.y1).toBeGreaterThan(r.y0);
      expect(Math.min(r.x0, r.y0)).toBeGreaterThanOrEqual(0);
      expect(Math.max(r.x1, r.y1)).toBeLessThanOrEqual(1000);
    }
    expect(viewToRoi(2, -5000, 0, vp, 1000, 1000)).toEqual({ x0: 999, y0: 0, x1: 1000, y1: 300 });
  });
});
