import { u32Decode, u64Decode, viDecode } from './varint';
import { crc32c } from '../codec/crc32c';

export const FLOW_PINCELADA = 0x01;

export interface BrushHead {
  handle: number;
  delivery: number;
  brushId: bigint;
  stratum: number;
  from: number;
  through: number;
  epoch: number;
  qY: number;
  qC: number;
  edition: number;
  crcs: number[];
  lengths: number[];
  headerBytes: number;
}

export function splitBrushId(id: bigint): { stratum: number; bx: number; by: number } {
  const stratum = Number((id >> 56n) & 0xffn);
  let morton = id & 0xffffffffffffffn;
  let bx = 0;
  let by = 0;
  for (let i = 0; morton > 0n && i < 28; i++) {
    if ((morton & 1n) !== 0n) bx |= 1 << i;
    if ((morton & 2n) !== 0n) by |= 1 << i;
    morton >>= 2n;
  }
  return { stratum, bx, by };
}

export function makeBrushId(stratum: number, bx: number, by: number): bigint {
  let morton = 0n;
  for (let i = 0; i < 28; i++) {
    if ((bx >> i) & 1) morton |= 1n << BigInt(i * 2);
    if ((by >> i) & 1) morton |= 1n << BigInt(i * 2 + 1);
  }
  return (BigInt(stratum & 0xff) << 56n) | morton;
}

export function parseBrushHead(bytes: Uint8Array): BrushHead {
  let p = 0;
  let r = viDecode(bytes, p);
  if (r.value !== FLOW_PINCELADA) throw new Error('brush: bad tipo_flujo');
  p = r.next;
  r = viDecode(bytes, p); const handle = r.value; p = r.next;
  r = viDecode(bytes, p); const delivery = r.value; p = r.next;
  const id = u64Decode(bytes, p); p = id.next;
  const bands = bytes[p] ?? 0; p += 1;
  const from = (bands >> 4) & 0x0f;
  const through = bands & 0x0f;
  r = viDecode(bytes, p); const epoch = r.value; p = r.next;
  const qY = bytes[p] ?? 0; const qC = bytes[p + 1] ?? 0; p += 2;
  r = viDecode(bytes, p); const edition = r.value; p = r.next;
  const n = through - from;
  if (n <= 0 || n > 4) throw new Error('brush: bad bands');
  const crcs: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = u32Decode(bytes, p);
    crcs.push(c.value);
    p = c.next;
  }
  const lengths: number[] = [];
  for (let i = 0; i < n; i++) {
    r = viDecode(bytes, p);
    lengths.push(r.value);
    p = r.next;
  }
  return {
    handle, delivery, brushId: id.value, stratum: Number((id.value >> 56n) & 0xffn),
    from, through, epoch, qY, qC, edition, crcs, lengths, headerBytes: p,
  };
}

export function sliceBands(bytes: Uint8Array, h: BrushHead): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = h.headerBytes;
  for (const len of h.lengths) {
    if (p + len > bytes.length) throw new Error('brush: truncated band');
    out.push(bytes.slice(p, p + len));
    p += len;
  }
  return out;
}

export function verifyBand(band: Uint8Array, expect: number): boolean {
  return crc32c(band) === (expect >>> 0);
}

/**
 * Cache/family identity: deliveries of one brush + edition share bands and
 * parents. The worker builds the same `${brush}/${edition}` string on its side.
 */
export function brushKey(brushId: bigint, edition: number): string {
  return `${brushId.toString()}/${edition}`;
}
