import { describe, expect, it } from 'vitest';
import { workMp, type Work } from '../types';

const work = (width: number, height: number): Work => ({
  id: 'w', name: '', width, height, strata: 0, state: 3, edition: 2, progress: 1,
});

describe('workMp', () => {
  it('counts tiny works in kpx', () => {
    expect(workMp(work(200, 300))).toBe('60.0 kpx');
  });

  it('counts megapixel works in MP', () => {
    expect(workMp(work(3_588, 2_400))).toBe('8.6 MP');
    expect(workMp(work(31_000, 31_000))).toBe('961.0 MP');
  });

  it('counts works from a thousand megapixels in GP', () => {
    expect(workMp(work(176_393, 176_393))).toBe('31.1 GP');
    expect(workMp(work(40_000, 40_000))).toBe('1.6 GP');
    expect(workMp(work(31_622, 31_622))).toBe('1.0 GP'); // 999.95 MP rounds up into GP
  });
});
