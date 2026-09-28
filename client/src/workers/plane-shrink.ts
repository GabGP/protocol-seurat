/** Y, Co, Cg planes, `width × height` each. */
export interface Planes {
  planes: Int16Array[];
  width: number;
  height: number;
}

/** A pixel rectangle: `x, y` its corner, `w × h` its size. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

/** The card's size for a level `w × h` shown `width` wide (height in proportion); narrower already, it is kept. */
export function shownSize(w: number, h: number, width: number): { width: number; height: number } {
  if (width <= 0 || w <= width) return { width: w, height: h };
  return { width, height: Math.max(1, Math.round((h * width) / w)) };
}

/** Outputs `[o0, o1)` (of `m`, from `n`) that take in source `[a, b)`, and the source `[s0, s1)` they read. */
function reach(n: number, m: number, a: number, b: number): [number, number, number, number] {
  if (m >= n) return [a, b, a, b];
  const sp = spans(n, m);
  const scale = n / m;
  const o0 = Math.max(0, Math.floor(a / scale) - 1);
  const o1 = Math.min(m, Math.ceil(b / scale) + 1);
  const first = sp[o0] ?? { start: 0, weights: [] };
  const last = sp[o1 - 1] ?? { start: n, weights: [] };
  return [o0, o1, first.start, last.start + last.weights.length];
}

/** The part `out` of a `dw × dh` image that samples `dirty` of a `sw × sh` level, and the level part `src` it reads. */
export function patchRegion(sw: number, sh: number, dw: number, dh: number, dirty: Rect): { out: Rect; src: Rect } {
  const [ox0, ox1, sx0, sx1] = reach(sw, dw, dirty.x, dirty.x + dirty.w);
  const [oy0, oy1, sy0, sy1] = reach(sh, dh, dirty.y, dirty.y + dirty.h);
  return { out: { x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0 }, src: { x: sx0, y: sy0, w: sx1 - sx0, h: sy1 - sy0 } };
}

/** Separable box average of one plane's part `src` into the outputs whose spans are `across × down`. */
function shrinkPlane(p: Int16Array, src: Rect, across: Span[], down: Span[]): Int16Array {
  const dw = across.length;
  const rows = new Float32Array(dw * src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < dw; x++) {
      const { start, weights } = across[x] ?? { start: 0, weights: [] };
      const at = y * src.w + start - src.x;
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += (p[at + k] ?? 0) * (weights[k] ?? 0);
      rows[y * dw + x] = v;
    }
  }
  const out = new Int16Array(dw * down.length);
  for (let y = 0; y < down.length; y++) {
    const { start, weights } = down[y] ?? { start: 0, weights: [] };
    for (let x = 0; x < dw; x++) {
      let v = 0;
      for (let k = 0; k < weights.length; k++) v += (rows[(start - src.y + k) * dw + x] ?? 0) * (weights[k] ?? 0);
      out[y * dw + x] = Math.round(v);
    }
  }
  return out;
}

/**
 * Part `out` of the level `sw × sh` shrunk to `dw × dh`, from `planes`, the level's part `src`
 * (as `patchRegion` gives them). Not shrunk, `src` is `out` and the planes are kept as they are.
 */
export function shrinkRegion(planes: Int16Array[], src: Rect, sw: number, sh: number, dw: number, dh: number, out: Rect): Int16Array[] {
  if (dw >= sw) return planes;
  const across = spans(sw, dw).slice(out.x, out.x + out.w);
  const down = spans(sh, dh).slice(out.y, out.y + out.h);
  return planes.map((p) => shrinkPlane(p, src, across, down));
}

/** The composite at the card's width (height kept in proportion), all of it. */
export function shrinkTo(d: Planes, width: number): Planes {
  const size = shownSize(d.width, d.height, width);
  if (size.width === d.width) return d;
  const whole = { x: 0, y: 0, w: d.width, h: d.height };
  const out = { x: 0, y: 0, w: size.width, h: size.height };
  return { planes: shrinkRegion(d.planes, whole, d.width, d.height, size.width, size.height, out), ...size };
}

/** Part `r` of planes `width` wide, copied out. */
export function cutRegion(planes: Int16Array[], width: number, r: Rect): Int16Array[] {
  return planes.map((p) => {
    const out = new Int16Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) out.set(p.subarray((r.y + y) * width + r.x, (r.y + y) * width + r.x + r.w), y * r.w);
    return out;
  });
}
