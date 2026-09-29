import { ByteReader } from './byte-reader';

export function ulebEncode(v: number): number[] {
  if (!Number.isSafeInteger(v) || v < 0) throw new Error('uleb: expecting non-negative safe int');
  const out: number[] = [];
  do {
    let b = v % 128;
    v = Math.floor(v / 128);
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return out;
}

export function ulebDecode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  const r = new ByteReader().reset(bytes, pos);
  const value = r.uleb();
  return { value, next: r.pos };
}

export function zigzagEncode(x: number): number {
  if (!Number.isSafeInteger(x)) throw new Error('zigzag: not a safe int');
  return x >= 0 ? x * 2 : -x * 2 - 1;
}

/** Unchecked zigzag decode, for the hot loops that already hold a valid uleb. */
export function zz(n: number): number {
  return (n & 1) === 0 ? n / 2 : -((n + 1) / 2);
}

export function zigzagDecode(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('zigzag: bad input');
  return zz(n);
}

export function sLebEncode(x: number): number[] {
  return ulebEncode(zigzagEncode(x));
}

export function sLebDecode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  const r = ulebDecode(bytes, pos);
  return { value: zigzagDecode(r.value), next: r.next };
}
