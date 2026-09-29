export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export const BYTE_MAX = 255;

/** `v` limited to one byte's range 0 … 255. */
export function clampByte(v: number): number {
  return clamp(v, 0, BYTE_MAX);
}
