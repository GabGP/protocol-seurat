import { describe, expect, it } from 'vitest';
import { cutRegion, patchRegion, shrinkRegion, shrinkTo } from '@/workers/plane-shrink';

const planes = (w: number, h: number, v: (x: number, y: number) => number) => ({
  planes: [0, 1, 2].map(() => Int16Array.from({ length: w * h }, (_, i) => v(i % w, Math.floor(i / w)))),
  width: w,
  height: h,
});

describe('shrinkTo', () => {
  it('averages the area each output sample covers', () => {
    const out = shrinkTo(planes(4, 2, (x) => (x < 2 ? 0 : 100)), 2);
    expect(out).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(out.planes[0] ?? [])).toEqual([0, 100]);
  });

  it('weighs a sample split between two outputs by the part each covers', () => {
    const out = shrinkTo(planes(3, 3, (x) => [0, 60, 120][x] ?? 0), 2);
    expect(out).toMatchObject({ width: 2, height: 2 });
    expect(Array.from(out.planes[1] ?? [])).toEqual([20, 100, 20, 100]);
  });

  it('keeps what is already no wider than the card', () => {
    const src = planes(300, 4, () => 7);
    expect(shrinkTo(src, 300)).toBe(src);
    expect(shrinkTo(src, 0)).toBe(src);
  });
});

describe('patchRegion', () => {
  const src = planes(37, 23, (x, y) => (x * 131 + y * 71) % 512 - 256);
  const full = shrinkTo(src, 11);

  it('finishes a changed part exactly as the whole shrink has it', () => {
    for (const dirty of [{ x: 0, y: 0, w: 5, h: 4 }, { x: 13, y: 9, w: 7, h: 3 }, { x: 30, y: 17, w: 7, h: 6 }, { x: 0, y: 0, w: 37, h: 23 }]) {
      const { out, src: from } = patchRegion(37, 23, full.width, full.height, dirty);
      expect(out.x * 37 / 11).toBeLessThanOrEqual(dirty.x);
      expect((out.x + out.w) * 37 / 11).toBeGreaterThanOrEqual(dirty.x + dirty.w);
      const part = shrinkRegion(cutRegion(src.planes, 37, from), from, 37, 23, full.width, full.height, out)[0] ?? [];
      const whole = cutRegion(full.planes, full.width, out)[0] ?? [];
      expect(Array.from(part)).toEqual(Array.from(whole));
    }
  });

  it('is the changed part itself when nothing is shrunk', () => {
    const dirty = { x: 3, y: 2, w: 4, h: 5 };
    expect(patchRegion(37, 23, 37, 23, dirty)).toEqual({ out: dirty, src: dirty });
  });
});
