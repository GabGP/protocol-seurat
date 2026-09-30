import { bytesToHex } from '@/shared/lib/hex';
import { clamp } from '@/shared/lib/clamp';
import { bitmapPixel } from './bitmap-pixel';

interface Sampled {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bitmap size, kept when the bitmap is closed (WebGL holds the pixels). */
  pw: number;
  ph: number;
  bmp?: object | null;
  delivery?: number;
  planes?: ArrayBuffer[] | null;
}

/**
 * Colour of image pixel (ix, iy) from the finest brush covering it (`brushes` is coarse → fine),
 * read from its decoded YCoCg-R planes: the same integer inverse the worker paints with. The finest
 * stratum keeps no planes (nothing is built on it): its pixel is read back from the bitmap, or, once
 * the GPU holds it and the bitmap is released, `needPlanes` asks for them and the coarser brush answers.
 */
export function samplePixelHex(brushes: readonly Sampled[], ix: number, iy: number, needPlanes?: (delivery: number) => void): string | null {
  for (let i = brushes.length - 1; i >= 0; i--) {
    const b = brushes[i];
    if (!b || ix < b.x || ix >= b.x + b.w || iy < b.y || iy >= b.y + b.h) continue;
    const [pY, pCo, pCg] = b.planes ?? [];
    const { pw, ph } = b;
    const n = pw * ph;
    const px = clamp(Math.floor(((ix - b.x) * pw) / b.w), 0, pw - 1);
    const py = clamp(Math.floor(((iy - b.y) * ph) / b.h), 0, ph - 1);
    if (!pY || !pCo || !pCg || n === 0 || pY.byteLength < n * 2 || pCo.byteLength < n * 2 || pCg.byteLength < n * 2) {
      const rgb = n === 0 || !b.bmp ? null : bitmapPixel(b.bmp, px, py);
      if (rgb) return ('#' + bytesToHex(rgb.subarray(0, 3))).toUpperCase();
      if (!b.bmp && b.delivery !== undefined) needPlanes?.(b.delivery);
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
