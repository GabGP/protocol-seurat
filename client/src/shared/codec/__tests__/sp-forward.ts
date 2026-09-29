/** Encoder side of the S transform and the quantizer: only the tests need it (the client decodes). */
export function quant(x: number, q: number): number {
  const m = Math.trunc(x / q);
  return Math.sign(x) * Math.abs(m);
}

export function forwardBlock(a: number, b: number, c: number, d: number): { s: number; h: number; v: number; dv: number } {
  const l1 = (a + b) >> 1;
  const h1 = a - b;
  const l2 = (c + d) >> 1;
  const h2 = c - d;
  return { s: (l1 + l2) >> 1, h: (h1 + h2) >> 1, v: l1 - l2, dv: h1 - h2 };
}
