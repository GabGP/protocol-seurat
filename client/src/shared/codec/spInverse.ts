/** S+P prediction of a detail from the two parent samples on either side of it along its axis. */
export function spPredict(before: number, after: number): number {
  return (before - after + 2) >> 2;
}

/** Dequantize an index; a zero index, or a channel sent without quantizer (q <= 0), is 0. */
export function deq(i: number, q: number): number {
  if (i === 0 || q <= 0) return 0;
  const s = i > 0 ? 1 : -1;
  return s * (Math.abs(i) * q + Math.floor(q / 2));
}

/**
 * Inverse S-transform of one parent sample `s` with its horizontal, vertical and diagonal details:
 * writes the 2x2 child block at `row0`/`row1` (the offsets of its top-left and bottom-left samples).
 */
export function liftBlock(out: Int16Array, row0: number, row1: number, s: number, h: number, v: number, d: number): void {
  const l1 = s + ((v + 1) >> 1);
  const l2 = l1 - v;
  const h1 = h + ((d + 1) >> 1);
  const h2 = h1 - d;
  const a = l1 + ((h1 + 1) >> 1);
  out[row0] = a;
  out[row0 + 1] = a - h1;
  const c = l2 + ((h2 + 1) >> 1);
  out[row1] = c;
  out[row1 + 1] = c - h2;
}
