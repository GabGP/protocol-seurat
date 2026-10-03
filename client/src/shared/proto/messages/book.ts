import { Reader } from '../reader';
import { teselasEncode } from '../teselas';
import { concat, viEncode } from '../varint';

export interface Receipt { handle: number; completed: number[]; queueMs: number; free: number; renewThrough: number }
export function receiptCore(r: Receipt): Uint8Array {
  return concat(
    viEncode(r.handle), teselasEncode(r.completed), viEncode(r.queueMs),
    viEncode(r.free), viEncode(r.renewThrough),
  );
}
export function receiptDecode(payload: Uint8Array): Receipt {
  const r = new Reader(payload);
  return { handle: r.vi(), completed: r.teselas(), queueMs: r.vi(), free: r.vi(), renewThrough: r.vi() };
}

export interface Release { handle: number; reason: number; ranges: number[] }
export function releaseCore(s: Release): Uint8Array {
  return concat(viEncode(s.handle), [s.reason], teselasEncode(s.ranges));
}
export function releaseDecode(payload: Uint8Array): Release {
  const r = new Reader(payload);
  return { handle: r.vi(), reason: r.u8(), ranges: r.teselas() };
}

export interface Renew { handle: number; order: number; leaseS: number; ranges: number[] }
export function renewCore(r: Renew): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.leaseS), teselasEncode(r.ranges));
}
export function renewDecode(payload: Uint8Array): Renew {
  const r = new Reader(payload);
  return { handle: r.vi(), order: r.vi(), leaseS: r.vi(), ranges: r.teselas() };
}

export interface Audit { handle: number; order: number; through: number }
export function auditCore(a: Audit): Uint8Array {
  return concat(viEncode(a.handle), viEncode(a.order), viEncode(a.through));
}
export function auditDecode(payload: Uint8Array): Audit {
  const r = new Reader(payload);
  return { handle: r.vi(), order: r.vi(), through: r.vi() };
}

export interface Inventory {
  handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[];
}
export function inventoryCore(v: Inventory): Uint8Array {
  return concat(
    viEncode(v.handle), viEncode(v.order), viEncode(v.through),
    viEncode(v.brushCount), viEncode(v.kib), teselasEncode(v.ranges),
  );
}
export function inventoryDecode(payload: Uint8Array): Inventory {
  const r = new Reader(payload);
  return {
    handle: r.vi(), order: r.vi(), through: r.vi(), brushCount: r.vi(), kib: r.vi(), ranges: r.teselas(),
  };
}
