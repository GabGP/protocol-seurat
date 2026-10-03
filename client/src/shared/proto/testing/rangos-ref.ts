// Seurat/1 v1.0 Rangos, replaced by Teselas (ADR-09); kept as the baseline the ADR-09 bench compares against.
import { concat, viDecode, viEncode } from '../varint';

export function rangosEncode(nums: readonly number[]): Uint8Array {
  const clean = [...new Set(nums)].filter((n) => n >= 1 && Number.isSafeInteger(n)).sort((a, b) => a - b);
  if (clean.length === 0) return Uint8Array.of(0, 0, 0);

  const ranges: Array<[number, number]> = [];
  let lo = clean[0]!;
  let hi = lo;
  for (let i = 1; i <= clean.length; i++) {
    const cur = i < clean.length ? clean[i]! : -1;
    if (cur === hi + 1) {
      hi = cur;
      continue;
    }
    ranges.push([lo, hi]);
    lo = cur;
    hi = cur;
  }

  const top = ranges[ranges.length - 1]!;
  const mayor = top[1];
  const nHuecos = ranges.length - 1;
  const primerRango = top[1] - top[0];

  const parts: number[][] = [viEncode(mayor), viEncode(nHuecos), viEncode(primerRango)];
  let prevLow = top[0];
  for (let i = ranges.length - 2; i >= 0; i--) {
    const r = ranges[i]!;
    const hueco = prevLow - r[1] - 2;
    const largo = r[1] - r[0];
    parts.push(viEncode(hueco), viEncode(largo));
    prevLow = r[0];
  }
  return concat(...parts);
}

/** The v1.0 decoder, for the bench's timing baseline: values ascending. */
export function rangosDecode(bytes: Uint8Array, pos: number): { values: number[]; next: number } {
  const field = (): number => {
    const r = viDecode(bytes, pos);
    pos = r.next;
    return r.value;
  };
  const mayor = field();
  const nHuecos = field();
  const primer = field();
  if (mayor === 0) return { values: [], next: pos };
  const runs: number[][] = [];
  let lo = mayor - primer;
  runs.push([lo, mayor]);
  for (let i = 0; i < nHuecos; i++) {
    const hi = lo - field() - 2;
    lo = hi - field();
    runs.push([lo, hi]);
  }
  const values: number[] = [];
  for (let i = runs.length - 1; i >= 0; i--) for (let n = runs[i]![0]!; n <= runs[i]![1]!; n++) values.push(n);
  return { values, next: pos };
}
