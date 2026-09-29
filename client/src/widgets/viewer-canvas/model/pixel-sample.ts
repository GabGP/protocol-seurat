import { bytesToHex } from '@/shared/lib/hex';
import { clamp } from '@/shared/lib/clamp';
import { bitmapPixel } from './bitmap-pixel';

interface Sampled {
  x: number;
  y: number;
  w: number;
  h: number;
  bmp: { width: number; height: number };
  planes?: ArrayBuffer[] | null;
}

/**
 * Colour of image pixel (ix, iy) from the finest brush covering it (`brushes` is coarse → fine),
 * read from its decoded YCoCg-R planes: the same integer inverse the worker paints with. The finest
 * stratum keeps no planes (nothing is built on it): its pixel is read back from the bitmap.
 */
export function samplePixelHex(brushes: readonly Sampled[], ix: number, iy: number): string | null {
  for (let i = brushes.length - 1; i >= 0; i--) {
    const b = brushes[i];
    if (!b || ix < b.x || ix >= b.x + b.w || iy < b.y || iy >= b.y + b.h) continue;
    const [pY, pCo, pCg] = b.planes ?? [];
    const pw = b.bmp.width;
    const ph = b.bmp.height;
    const n = pw * ph;
    const px = clamp(Math.floor(((ix - b.x) * pw) / b.w), 0, pw - 1);
    const py = clamp(Math.floor(((iy - b.y) * ph) / b.h), 0, ph - 1);
    if (!pY || !pCo || !pCg || n === 0 || pY.byteLength < n * 2 || pCo.byteLength < n * 2 || pCg.byteLength < n * 2) {
      const rgb = n === 0 ? null : bitmapPixel(b.bmp, px, py);
      if (rgb) return ('#' + bytesToHex(rgb.subarray(0, 3))).toUpperCase();
      continue;
    }
    const at = py * pw + px;
    const y = new Int16Array(pY, at * 2, 1)[0] ?? 0;
    const co = new Int16Array(pCo, at * 2, 1)[0] ?? 0;
    const cg = new Int16Array(pCg, at * 2, 1)[0] ?? 0;
    const t = y - (cg >> 1);
    const g = cg + t;
    const blue = t - (co >> 1);
    return ('#' + bytesToHex(Uint8ClampedArray.of(blue + co, g, blue))).toUpperCase();
  }
  return null;
}
