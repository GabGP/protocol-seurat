import { TlvTag } from '../../config/constants';
import { parseTlvs, tlvEncode } from '../frame';
import { rangesEncode } from '../ranges';
import { Reader } from '../reader';
import { concat, u64Encode, viEncode } from '../varint';

export interface Gaze {
  handle: number; seq: number; x0: number; y0: number; x1: number; y1: number;
  vw: number; vh: number; flags: number;
}
export function gazeCore(m: Gaze): Uint8Array {
  return concat(
    viEncode(m.handle), viEncode(m.seq), viEncode(m.x0), viEncode(m.y0),
    viEncode(m.x1), viEncode(m.y1), viEncode(m.vw), viEncode(m.vh), [m.flags],
  );
}
export function gazeDecode(payload: Uint8Array): Gaze {
  const r = new Reader(payload);
  return {
    handle: r.vi(), seq: r.vi(), x0: r.vi(), y0: r.vi(), x1: r.vi(), y1: r.vi(),
    vw: r.vi(), vh: r.vi(), flags: r.u8(),
  };
}

export interface Concession {
  handle: number; epoch: number; minStratum: number; maxBands: number; reason: number;
  maxBrushes: number; maxKiB: number; leaseS: number;
}
export function concessionCore(c: Concession): Uint8Array {
  return concat(
    viEncode(c.handle), viEncode(c.epoch), [c.minStratum, c.maxBands, c.reason],
    viEncode(c.maxBrushes), viEncode(c.maxKiB), viEncode(c.leaseS),
  );
}
export function concessionDecode(payload: Uint8Array): Concession {
  const r = new Reader(payload);
  return {
    handle: r.vi(), epoch: r.vi(), minStratum: r.u8(), maxBands: r.u8(), reason: r.u8(),
    maxBrushes: r.vi(), maxKiB: r.vi(), leaseS: r.vi(),
  };
}

export type PlanMsg =
  | {
      handle: number;
      gazeSeq: number;
      event: 0;
      first: number;
      expectedCount: number;
      throttle: number;
      unrecoverable?: bigint[];
    }
  | { handle: number; gazeSeq: number; event: 1; last: number }
  | { handle: number; gazeSeq: number; event: 2; cancelled: number[] };
export function planCore(p: PlanMsg): Uint8Array {
  const head = concat(viEncode(p.handle), viEncode(p.gazeSeq), [p.event]);
  if (p.event === 0) {
    const core = concat(head, viEncode(p.first), viEncode(p.expectedCount), [p.throttle]);
    if (p.unrecoverable && p.unrecoverable.length > 0) {
      const parts: Array<number[] | Uint8Array> = [viEncode(p.unrecoverable.length)];
      for (const id of p.unrecoverable) parts.push(u64Encode(id));
      return concat(core, tlvEncode(TlvTag.UNRECOVERABLE, concat(...parts)));
    }
    return core;
  }
  if (p.event === 1) return concat(head, viEncode(p.last));
  return concat(head, rangesEncode(p.cancelled));
}
export function planDecode(payload: Uint8Array): PlanMsg {
  const r = new Reader(payload);
  const handle = r.vi();
  const gazeSeq = r.vi();
  const event = r.u8();
  if (event === 0) {
    const first = r.vi();
    const expectedCount = r.vi();
    const throttle = r.u8();
    let unrecoverable: bigint[] | undefined;
    const rest = r.rest();
    if (rest.length > 0) {
      for (const t of parseTlvs(rest)) {
        if (t.tag === TlvTag.UNRECOVERABLE) {
          const v = new Reader(t.value);
          const list: bigint[] = [];
          for (let i = 0, n = v.vi(); i < n; i++) list.push(v.u64());
          unrecoverable = list;
        }
      }
    }
    const out: PlanMsg = { handle, gazeSeq, event: 0, first, expectedCount, throttle };
    if (unrecoverable !== undefined) out.unrecoverable = unrecoverable;
    return out;
  }
  if (event === 1) return { handle, gazeSeq, event, last: r.vi() };
  return { handle, gazeSeq, event: 2, cancelled: r.ranges() };
}
