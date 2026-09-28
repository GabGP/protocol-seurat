/** YCoCg-R planes to opaque RGBA, `px` samples (the lifting's inverse, as the viewer shows them). */
export function planesToRgba(Y: Int16Array, Co: Int16Array, Cg: Int16Array, px: number): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const co = Co[i] ?? 0;
    const cg = Cg[i] ?? 0;
    const t = (Y[i] ?? 0) - (cg >> 1);
    const b = t - (co >> 1);
    const off = i * 4;
    rgba[off] = b + co;
    rgba[off + 1] = cg + t;
    rgba[off + 2] = b;
    rgba[off + 3] = 255;
  }
  return rgba;
}

/** The bitmap built in the worker, not on the main thread (it copies + decodes there); null when unsupported. */
export async function toBitmap(rgba: Uint8ClampedArray, w: number, h: number): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') return null;
  try {
    return await createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h));
  } catch {
    return null;
  }
}
