import type { SynthResult } from '@/workers/protocol';

/** The image a worker answered with: its transferred bitmap, or one built from the raw bytes. */
export function bitmapOf(out: SynthResult): Promise<ImageBitmap> {
  if (out.bitmap) return Promise.resolve(out.bitmap);
  return createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba ?? new ArrayBuffer(0)), out.width, out.height));
}
