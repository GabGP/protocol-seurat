import { MANDATORY_TYPE_LIMIT, MAX_FRAME_BYTES } from '../config/constants';
import { concat, viDecode, viEncode } from './varint';

export interface Tlv {
  tag: number;
  value: Uint8Array;
}

export interface Frame {
  type: number;
  payload: Uint8Array;
  tlvs: Tlv[];
}

export class FatalProtocolError extends Error {
  code = 1;
  constructor(msg: string) {
    super(msg);
    this.name = 'FatalProtocolError';
  }
}

export function parseTlvs(tail: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  let pos = 0;
  while (pos < tail.length) {
    const t = viDecode(tail, pos);
    const l = viDecode(tail, t.next);
    const end = l.next + l.value;
    if (end > tail.length) throw new FatalProtocolError('TLV truncated');
    out.push({ tag: t.value, value: tail.slice(l.next, end) });
    pos = end;
  }
  return out;
}

export function tlvEncode(tag: number, value: Uint8Array): Uint8Array {
  return concat(viEncode(tag), viEncode(value.length), value);
}

export function encodeFrame(type: number, core: Uint8Array, tlvs: Uint8Array[] = []): Uint8Array {
  const payload = concat(core, ...tlvs);
  if (payload.length > MAX_FRAME_BYTES) throw new FatalProtocolError('frame exceeds 64 KiB');
  return concat(viEncode(type), viEncode(payload.length), payload);
}

export function decodeFrame(bytes: Uint8Array, coreLength: (payload: Uint8Array) => number): Frame | null {
  let pos = 0;
  const t = viDecode(bytes, pos);
  pos = t.next;
  const l = viDecode(bytes, pos);
  pos = l.next;
  if (l.value > MAX_FRAME_BYTES) throw new FatalProtocolError('frame exceeds 64 KiB');
  if (pos + l.value > bytes.length) throw new FatalProtocolError('frame truncated');
  const payload = bytes.slice(pos, pos + l.value);
  const known = coreLength(payload);
  if (known < 0) {
    if (t.value < MANDATORY_TYPE_LIMIT) throw new FatalProtocolError('ERROR 1: unknown mandatory type');
    return null;
  }
  return { type: t.value, payload, tlvs: parseTlvs(payload.slice(known)) };
}

export function splitFrame(bytes: Uint8Array): { type: number; payload: Uint8Array; total: number } {
  let pos = 0;
  const t = viDecode(bytes, pos);
  pos = t.next;
  const l = viDecode(bytes, pos);
  pos = l.next;
  if (l.value > MAX_FRAME_BYTES) throw new FatalProtocolError('frame exceeds 64 KiB');
  if (pos + l.value > bytes.length) throw new Error('frame: need more bytes');
  return { type: t.value, payload: bytes.slice(pos, pos + l.value), total: pos + l.value };
}

/** Every frame packed back to back in one control message. */
export function splitAll(frame: Uint8Array): Array<{ type: number; payload: Uint8Array }> {
  const out: Array<{ type: number; payload: Uint8Array }> = [];
  let pos = 0;
  while (pos < frame.length) {
    const s = splitFrame(frame.slice(pos));
    out.push({ type: s.type, payload: s.payload });
    pos += s.total;
  }
  return out;
}
