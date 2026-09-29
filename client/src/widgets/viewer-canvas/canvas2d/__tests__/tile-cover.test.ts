import { describe, expect, it } from 'vitest';
import { snapSpan, tilesCover } from '../tile-cover';
import { aroundHole } from '../render-sprites';
import { SKETCH_STRATUM, type BrushGeom } from '@/entities/delivery';

function tile(stratum: number, bx: number, by: number): BrushGeom {
  const size = 256 * 2 ** stratum;
  return { delivery: 0, stratum, bx, by, x: bx * size, y: by * size, w: size, h: size, bmp: {} as ImageBitmap };
}
const sketch: BrushGeom = { ...tile(0, 0, 0), stratum: SKETCH_STRATUM };

describe('tilesCover', () => {
  it('is false with only the sketch, true when one tile spans the region', () => {
    expect(tilesCover([sketch], { x0: 0, y0: 0, x1: 100, y1: 100 }, 1000, 1000)).toBe(false);
    expect(tilesCover([sketch, tile(0, 0, 0)], { x0: 10, y0: 10, x1: 200, y1: 200 }, 1000, 1000)).toBe(true);
  });

  it('accepts a mix of strata and rejects a single missing cell', () => {
    const quad = [tile(0, 2, 0), tile(0, 3, 0), tile(0, 2, 1), tile(0, 3, 1)];
    const region = { x0: 0, y0: 0, x1: 1024, y1: 512 };
    expect(tilesCover([tile(1, 0, 0), ...quad], region, 4096, 4096)).toBe(true);
    expect(tilesCover([tile(1, 0, 0), ...quad.slice(1)], region, 4096, 4096)).toBe(false);
  });

  it('only needs cells inside the image (edge tiles)', () => {
    // 300px image: the 512 cell's children at x/y >= 512 do not exist, 256..300 does.
    expect(tilesCover([tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1), tile(0, 1, 1)], { x0: -50, y0: -50, x1: 900, y1: 900 }, 300, 300)).toBe(true);
    expect(tilesCover([tile(0, 0, 0), tile(0, 1, 0), tile(0, 0, 1)], { x0: 0, y0: 0, x1: 300, y1: 300 }, 300, 300)).toBe(false);
  });

  it('bails out early when the view holds more cells than there are tiles', () => {
    expect(tilesCover([tile(0, 0, 0)], { x0: 0, y0: 0, x1: 100_000, y1: 100_000 }, 100_000, 100_000)).toBe(false);
  });
});

describe('snapSpan', () => {
  it('makes neighbours abut exactly at any scale and ratio', () => {
    for (const [t, s, dpr] of [[0.37, 0.731, 1.25], [-1234.56, 3.3333, 1.5], [17.2, 1, 1]] as const) {
      for (let x = 0; x < 2048; x += 256) {
        const [a, w] = snapSpan(t + x * s, t + (x + 256) * s, dpr);
        const [b] = snapSpan(t + (x + 256) * s, t + (x + 512) * s, dpr);
        expect(Math.round((a + w) * dpr)).toBe(Math.round(b * dpr));
        expect(Number.isInteger(Math.round(a * dpr * 1e6) / 1e6)).toBe(true);
      }
    }
  });
});

describe('aroundHole', () => {
  it('paints everything without a hole, and only the frame around a hole', () => {
    expect(aroundHole(100, 80, null)).toEqual([[0, 0, 100, 80]]);
    const bands = aroundHole(100, 80, { x0: 10.5, y0: 20.2, x1: 60.7, y1: 50 });
    const area = bands.reduce((a, [, , w, h]) => a + w * h, 0);
    expect(area).toBe(100 * 80 - (59 - 12) * (49 - 22)); // hole shrunk 1px inside its edges
    expect(aroundHole(100, 80, { x0: -5, y0: -5, x1: 200, y1: 200 })).toEqual([]);
  });
});
