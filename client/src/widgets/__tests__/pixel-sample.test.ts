import { describe, expect, it } from 'vitest';
import { samplePixelHex } from '../pixel-sample';

/** Forward YCoCg-R (the codec's colour transform), so tests can state colours in RGB. */
function ycocg(r: number, g: number, b: number): [number, number, number] {
  const co = r - b;
  const t = b + (co >> 1);
  const cg = g - t;
  return [t + (cg >> 1), co, cg];
}

function planes(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): ArrayBuffer[] {
  const Y = new Int16Array(w * h);
  const Co = new Int16Array(w * h);
  const Cg = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [a, b, c] = ycocg(...rgb(x, y));
      Y[y * w + x] = a;
      Co[y * w + x] = b;
      Cg[y * w + x] = c;
    }
  }
  return [Y.buffer, Co.buffer, Cg.buffer];
}

describe('samplePixelHex (from decoded planes)', () => {
  const coarse = { x: 0, y: 0, w: 100, h: 100, bmp: { width: 10, height: 10 }, planes: planes(10, 10, () => [0x12, 0x34, 0x56]) };
  const fine = { x: 10, y: 10, w: 20, h: 20, bmp: { width: 20, height: 20 }, planes: planes(20, 20, (x) => [x * 10, 200, 7]) };

  it('reads the finest covering brush, in uppercase hex', () => {
    expect(samplePixelHex([coarse, fine], 15, 15)).toBe('#32C807'); // fine px (5,5): r = 50
    expect(samplePixelHex([coarse, fine], 50, 50)).toBe('#123456');
  });

  it('maps image px onto a smaller bitmap (sketch scale)', () => {
    const sketch = { x: 0, y: 0, w: 100, h: 100, bmp: { width: 10, height: 10 }, planes: planes(10, 10, (x, y) => [x, y, 0]) };
    expect(samplePixelHex([sketch], 95, 42)).toBe('#090400');
  });

  it('skips brushes without usable planes and returns null outside the image', () => {
    const detached = { ...fine, planes: [new ArrayBuffer(0), new ArrayBuffer(0), new ArrayBuffer(0)] };
    expect(samplePixelHex([coarse, detached], 15, 15)).toBe('#123456');
    expect(samplePixelHex([coarse, { ...fine, planes: null }], 15, 15)).toBe('#123456');
    expect(samplePixelHex([coarse], 999, 999)).toBeNull();
  });

  it('clamps out-of-gamut values like the worker paint does', () => {
    const hot = { x: 0, y: 0, w: 1, h: 1, bmp: { width: 1, height: 1 }, planes: [
      new Int16Array([400]).buffer, new Int16Array([0]).buffer, new Int16Array([0]).buffer,
    ] };
    expect(samplePixelHex([hot], 0, 0)).toBe('#FFFFFF');
  });
});
