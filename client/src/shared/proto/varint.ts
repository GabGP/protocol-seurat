const MAX_VI = (1n << 62n) - 1n;

export function viEncode(v: number | bigint): number[] {
  const b = typeof v === 'bigint' ? v : BigInt(v);
  if (typeof v === 'number' && !Number.isSafeInteger(v)) throw new Error('vi: out of range');
  if (b < 0n || b > MAX_VI) throw new Error('vi: out of range');
  if (b < 64n) return [Number(b)];
  if (b < 16384n) return [0x40 | Number(b >> 8n), Number(b & 0xffn)];
  if (b < 1073741824n) {
    return [0x80 | Number((b >> 24n) & 0xffn), Number((b >> 16n) & 0xffn), Number((b >> 8n) & 0xffn), Number(b & 0xffn)];
  }
  const out: number[] = [0xc0 | Number((b >> 56n) & 0x3fn)];
  for (let i = 6; i >= 0; i--) out.push(Number((b >> BigInt(i * 8)) & 0xffn));
  return out;
}

/** viEncode for a safe integer, appended to `out` without BigInt or a temporary array (hot encoders). */
export function viPush(out: number[], v: number): void {
  if (v < 0 || !Number.isSafeInteger(v)) throw new Error('vi: out of range');
  if (v < 64) {
    out.push(v);
    return;
  }
  if (v < 16384) {
    out.push(0x40 | (v >> 8), v & 0xff);
    return;
  }
  if (v < 1073741824) {
    out.push(0x80 | (v >>> 24), (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return;
  }
  const hi = Math.floor(v / 2 ** 32);
  const lo = v >>> 0;
  out.push(
    0xc0 | ((hi >>> 24) & 0x3f),
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  );
}

export function viDecodeBig(bytes: Uint8Array, pos: number): { value: bigint; next: number } {
  const first = bytes[pos];
  if (first === undefined) throw new Error('vi: truncated');
  const len = 1 << (first >> 6);
  let value = BigInt(first & 0x3f);
  for (let i = 1; i < len; i++) {
    const b = bytes[pos + i];
    if (b === undefined) throw new Error('vi: truncated');
    value = value * 256n + BigInt(b);
  }
  return { value, next: pos + len };
}

export function viDecode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  const r = viDecodeBig(bytes, pos);
  if (r.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('vi: exceeds safe integer');
  return { value: Number(r.value), next: r.next };
}

export function viLengthOf(v: number): 1 | 2 | 4 | 8 {
  if (v < 64) return 1;
  if (v < 16384) return 2;
  if (v < 1073741824) return 4;
  return 8;
}

export function concat(...parts: Array<number[] | Uint8Array>): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p instanceof Uint8Array ? p : Uint8Array.from(p), o);
    o += p.length;
  }
  return out;
}

export function u64Encode(v: number | bigint): number[] {
  const b = BigInt(v);
  const out: number[] = [];
  for (let i = 7; i >= 0; i--) out.push(Number((b >> BigInt(i * 8)) & 0xffn));
  return out;
}

export function u64Decode(bytes: Uint8Array, pos: number): { value: bigint; next: number } {
  if (pos + 8 > bytes.length) throw new Error('u64: truncated');
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[pos + i] ?? 0);
  return { value: v, next: pos + 8 };
}

export function u32Encode(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

export function u32Decode(bytes: Uint8Array, pos: number): { value: number; next: number } {
  if (pos + 4 > bytes.length) throw new Error('u32: truncated');
  const v =
    ((bytes[pos] ?? 0) * 2 ** 24 + ((bytes[pos + 1] ?? 0) << 16) + ((bytes[pos + 2] ?? 0) << 8) + (bytes[pos + 3] ?? 0)) >>> 0;
  return { value: v, next: pos + 4 };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function strEncode(s: string): Uint8Array {
  const raw = encoder.encode(s);
  return concat(viEncode(raw.length), raw);
}

export function strDecode(bytes: Uint8Array, pos: number): { value: string; next: number } {
  const l = viDecode(bytes, pos);
  const end = l.next + l.value;
  if (end > bytes.length) throw new Error('str: truncated');
  return { value: decoder.decode(bytes.slice(l.next, end)), next: end };
}
