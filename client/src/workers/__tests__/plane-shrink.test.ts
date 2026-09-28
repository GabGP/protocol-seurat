import { describe, expect, it } from 'vitest';
import { shrinkTo } from '@/workers/plane-shrink';

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
