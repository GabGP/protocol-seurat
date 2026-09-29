import { inflateRaw } from './inflate';
import { ulebDecode, zigzagDecode } from './leb128';
import { yCoCgToRgb } from './ycocgr';
import { IMAGE_SMOOTHING_THRESHOLD } from '@/shared/config/render';
import { clampByte } from '@/shared/lib/clamp';

export async function decodeSeed(
  bandBytes: Uint8Array,
  width: number,
  height: number,
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const raw = await inflateRaw(bandBytes);
  const px = width * height;
  const planes: Record<'Y' | 'Co' | 'Cg', Int16Array> = {
    Y: new Int16Array(px),
    Co: new Int16Array(px),
    Cg: new Int16Array(px),
  };

  let p = 0;
  for (const ch of ['Y', 'Co', 'Cg'] as const) {
    const pl = planes[ch];
    for (let y = 0; y < height; y++) {
      let left = 0;
      for (let x = 0; x < width; x++) {
        const r = ulebDecode(raw, p);
        p = r.next;
        left += zigzagDecode(r.value);
        pl[y * width + x] = left;
      }
    }
  }

  const rgba = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const y = planes.Y[i] ?? 0;
    const co = planes.Co[i] ?? 0;
    const cg = planes.Cg[i] ?? 0;
    const { r, g, b } = yCoCgToRgb(y, co, cg);
    rgba[i * 4] = clampByte(r);
    rgba[i * 4 + 1] = clampByte(g);
    rgba[i * 4 + 2] = clampByte(b);
    rgba[i * 4 + 3] = 255;
  }

  return { rgba, width, height };
}

/** Two canvases reused by every draw; WebKit caps canvas memory and frees a dropped one only on GC. */
const scratch: HTMLCanvasElement[] = [];

function scratchCanvas(i: number, w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const c = (scratch[i] ??= document.createElement('canvas'));
  c.width = w;
  c.height = h;
  return c.getContext('2d');
}

/**
 * Draws an image at another size. When it is enlarged IMAGE_SMOOTHING_THRESHOLD times or
 * more, each sample first becomes a sharp block (as the viewer shows it), and only the
 * fraction left over is smoothed: a small image is not blurred into a smear.
 */
export function drawScaledRgba(
  targetCtx: CanvasRenderingContext2D,
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  const src = scratchCanvas(0, srcW, srcH);
  if (!src) return;
  src.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer), srcW, srcH), 0, 0);
  let from: CanvasRenderingContext2D = src;
  const k = Math.floor(Math.min(dstW / srcW, dstH / srcH));
  const blocks = k >= IMAGE_SMOOTHING_THRESHOLD ? scratchCanvas(1, srcW * k, srcH * k) : null;
  if (blocks) {
    blocks.imageSmoothingEnabled = false;
    blocks.drawImage(src.canvas, 0, 0, srcW * k, srcH * k);
    from = blocks;
  }
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';
  targetCtx.drawImage(from.canvas, 0, 0, dstW, dstH);
  for (const c of scratch) c.width = c.height = 0;
}
