export const MS_PER_S = 1000;
export const BYTES_PER_KIB = 1024;
export const PERCENT = 100;

/** Whole KiB that hold `bytes` (rounded up, as the wire counts them). */
export function toKib(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_KIB);
}
