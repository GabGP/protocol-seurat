import type { DecodedPlanes } from './preview-decoder';

/** One output sample's source span: first index and the weight of each source sample it covers. */
interface Span {
  start: number;
  weights: number[];
}

/** Area weights from `n` samples onto `m ≤ n`: each output averages the source it covers. */
function spans(n: number, m: number): Span[] {
  const scale = n / m;
  return Array.from({ length: m }, (_, i) => {
    const a = i * scale;
    const b = a + scale;
    const start = Math.floor(a);
    const weights: number[] = [];
    for (let j = start; j < Math.min(n, Math.ceil(b)); j++) weights.push((Math.min(b, j + 1) - Math.max(a, j)) / scale);
    return { start, weights };
  });
}

/** Separable box average of one plane from `sw × sh` down to `dw × dh`. */
function shrinkPlane(src: Int16Array, sw: number, sh: number, dw: number, dh: number): Int16Array {
  const across = spans(sw, dw);
  const down = spans(sh, dh);
  const rows = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      const { start, weights } = across[x] ?? { start: 0, weights: [] };
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += (src[y * sw + start + k] ?? 0) * (weights[k] ?? 0);
      rows[y * dw + x] = v;
    }
  }
  const out = new Int16Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const { start, weights } = down[y] ?? { start: 0, weights: [] };
    for (let x = 0; x < dw; x++) {
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += (rows[(start + k) * dw + x] ?? 0) * (weights[k] ?? 0);
      out[y * dw + x] = Math.round(v);
    }
  }
  return out;
}

/**
 * The composite at the card's width (height kept in proportion): what the thumbnail keeps is the
 * card's pixels, not the stratum's. Already narrower than `width`, it is kept as it is.
 */
export function shrinkTo(d: DecodedPlanes, width: number): DecodedPlanes {
  if (width <= 0 || d.width <= width) return d;
  const height = Math.max(1, Math.round((d.height * width) / d.width));
  return { planes: d.planes.map((p) => shrinkPlane(p, d.width, d.height, width, height)), width, height };
}
