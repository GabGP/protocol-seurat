type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let probe: Ctx | null | undefined;

function probeContext(): Ctx | null {
  if (probe !== undefined) return probe;
  const canvas = typeof OffscreenCanvas === 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1);
  canvas.width = 1;
  canvas.height = 1;
  probe = canvas.getContext('2d', { willReadFrequently: true }) as Ctx | null;
  if (probe) probe.globalCompositeOperation = 'copy';
  return probe;
}

/** One pixel of a decoded brush image (null when it is not a live bitmap): the readout of a brush that keeps no planes. */
export function bitmapPixel(bmp: object, px: number, py: number): Uint8ClampedArray | null {
  if (typeof ImageBitmap === 'undefined' || !(bmp instanceof ImageBitmap)) return null;
  try {
    const ctx = probeContext();
    if (!ctx) return null;
    ctx.drawImage(bmp, px, py, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  } catch {
    return null; // closed under us: its brush left the book
  }
}
