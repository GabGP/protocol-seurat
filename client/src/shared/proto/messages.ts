import { concat, strDecode, strEncode, u64Decode, u64Encode, viDecode, viEncode } from './varint';
import { rangesDecode, rangesEncode } from './ranges';
import { TlvTag } from '../config/constants';
import { FatalProtocolError, parseTlvs, tlvEncode } from './frame';

export const T = {
  SALUDO: 0x01, BIENVENIDA: 0x02, LATIDO: 0x03, ECO: 0x04, ERROR: 0x05, ADIOS: 0x06,
  CATALOGO: 0x10, OBRA: 0x11, ABRIR: 0x12, ABIERTA: 0x13, CERRAR: 0x14,
  MIRADA: 0x20, CONCESION: 0x21, PLAN: 0x23, RASPAR: 0x24, RASPADO: 0x25,
  RECIBO: 0x26, SOLTAR: 0x27, RENOVAR: 0x28, AUDITAR: 0x2a, INVENTARIO: 0x2b,
} as const;

/** A fixed u8 field; past the payload the frame is malformed (fatal ERROR 1), never 0. */
export function u8At(payload: Uint8Array, p: number): number {
  const v = payload[p];
  if (v === undefined) throw new FatalProtocolError('truncated payload');
  return v;
}

export const CAP_DATAGRAMAS = 0x01;
export const CAP_REANUDAR = 0x02;

export interface ResumeClaim { handle: number; ranges: number[] }
export interface Hello {
  minVersion: number; maxVersion: number; caps: number; memMib: number; token: Uint8Array;
  resume?: { previousSession: bigint; ticket: Uint8Array; claims: ResumeClaim[] };
}
export interface Welcome {
  version: number; caps: number; sessionId: bigint; lado: number; leaseS: number;
  heartbeatS: number; maxInFlight: number; sessionMaxBrushes: number;
  ticket: Uint8Array; resumed: number[];
}

export function helloCore(s: Hello): Uint8Array {
  return concat(
    viEncode(s.minVersion), viEncode(s.maxVersion), viEncode(s.caps), viEncode(s.memMib),
    viEncode(s.token.length), s.token,
  );
}

export function helloTlvs(s: Hello): Uint8Array[] {
  if (!s.resume) return [];
  const parts: Array<number[] | Uint8Array> = [
    u64Encode(s.resume.previousSession),
    s.resume.ticket,
    viEncode(s.resume.claims.length),
  ];
  for (const c of s.resume.claims) parts.push(viEncode(c.handle), rangesEncode(c.ranges));
  return [tlvEncode(TlvTag.RESUME, concat(...parts))];
}

export function helloDecode(payload: Uint8Array): Hello {
  let p = 0;
  let r = viDecode(payload, p); const minVersion = r.value; p = r.next;
  r = viDecode(payload, p); const maxVersion = r.value; p = r.next;
  r = viDecode(payload, p); const caps = r.value; p = r.next;
  r = viDecode(payload, p); const memMib = r.value; p = r.next;
  r = viDecode(payload, p); const tokenLen = r.value; p = r.next;
  const token = payload.slice(p, p + tokenLen); p += tokenLen;
  const out: Hello = { minVersion, maxVersion, caps, memMib, token };
  for (const t of parseTlvs(payload.slice(p))) {
    if (t.tag !== TlvTag.RESUME) continue;
    let q = 0;
    const s64 = u64Decode(t.value, q); q = s64.next;
    const ticket = t.value.slice(q, q + 32); q += 32;
    const n = viDecode(t.value, q); q = n.next;
    const claims: ResumeClaim[] = [];
    for (let i = 0; i < n.value; i++) {
      const h = viDecode(t.value, q); q = h.next;
      const rr = rangesDecode(t.value, q); q = rr.next;
      claims.push({ handle: h.value, ranges: rr.values });
    }
    out.resume = { previousSession: s64.value, ticket, claims };
  }
  return out;
}

export function welcomeCore(b: Welcome): Uint8Array {
  return concat(
    viEncode(b.version), viEncode(b.caps), u64Encode(b.sessionId), viEncode(b.lado),
    viEncode(b.leaseS), viEncode(b.heartbeatS), viEncode(b.maxInFlight),
    viEncode(b.sessionMaxBrushes),
  );
}

export function welcomeTlvs(b: Welcome): Uint8Array[] {
  const out = [tlvEncode(TlvTag.TICKET, b.ticket)];
  if (b.resumed.length > 0) {
    out.push(tlvEncode(TlvTag.RESUMED, concat(viEncode(b.resumed.length), ...b.resumed.map((h) => viEncode(h)))));
  }
  return out;
}

export function welcomeDecode(payload: Uint8Array): Welcome {
  let p = 0;
  let r = viDecode(payload, p); const version = r.value; p = r.next;
  r = viDecode(payload, p); const caps = r.value; p = r.next;
  const sid = u64Decode(payload, p); p = sid.next;
  r = viDecode(payload, p); const lado = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  r = viDecode(payload, p); const heartbeatS = r.value; p = r.next;
  r = viDecode(payload, p); const maxInFlight = r.value; p = r.next;
  r = viDecode(payload, p); const sessionMaxBrushes = r.value; p = r.next;
  const out: Welcome = {
    version, caps, sessionId: sid.value, lado, leaseS, heartbeatS,
    maxInFlight, sessionMaxBrushes, ticket: new Uint8Array(0), resumed: [],
  };
  for (const t of parseTlvs(payload.slice(p))) {
    if (t.tag === TlvTag.TICKET) out.ticket = t.value;
    else if (t.tag === TlvTag.RESUMED) {
      let q = 0;
      const n = viDecode(t.value, q); q = n.next;
      for (let i = 0; i < n.value; i++) {
        const h = viDecode(t.value, q); q = h.next;
        out.resumed.push(h.value);
      }
    }
  }
  return out;
}

export function heartbeatCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function heartbeatDecode(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}
export function echoCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function echoDecode(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}

export interface ProtocolError { code: number; fatal: number; refType: number; msg: string }
export function errorCore(e: ProtocolError): Uint8Array {
  return concat(viEncode(e.code), [e.fatal], viEncode(e.refType), strEncode(e.msg));
}
export function errorDecode(payload: Uint8Array): ProtocolError {
  let p = 0;
  let r = viDecode(payload, p); const code = r.value; p = r.next;
  const fatal = u8At(payload, p); p += 1;
  r = viDecode(payload, p); const refType = r.value; p = r.next;
  const s = strDecode(payload, p);
  return { code, fatal, refType, msg: s.value };
}

export interface Goodbye { code: number; msg: string }
export function goodbyeCore(a: Goodbye): Uint8Array {
  return concat(viEncode(a.code), strEncode(a.msg));
}
export function goodbyeDecode(payload: Uint8Array): Goodbye {
  const c = viDecode(payload, 0);
  const s = strDecode(payload, c.next);
  return { code: c.value, msg: s.value };
}

export interface WorkMessage {
  event: number; state: number; progress: number; edition: number;
  width: number; height: number; strata: number; id: string; name: string;
}
export function workCore(o: WorkMessage): Uint8Array {
  return concat(
    [o.event, o.state, o.progress], viEncode(o.edition), viEncode(o.width),
    viEncode(o.height), [o.strata], strEncode(o.id), strEncode(o.name),
  );
}
export function workDecode(payload: Uint8Array): WorkMessage {
  let p = 0;
  const event = u8At(payload, p); const state = u8At(payload, p + 1); const progress = u8At(payload, p + 2); p += 3;
  let r = viDecode(payload, p); const edition = r.value; p = r.next;
  r = viDecode(payload, p); const width = r.value; p = r.next;
  r = viDecode(payload, p); const height = r.value; p = r.next;
  const strata = u8At(payload, p); p += 1;
  const id = strDecode(payload, p); p = id.next;
  const name = strDecode(payload, p);
  return { event, state, progress, edition, width, height, strata, id: id.value, name: name.value };
}

export function openCore(id: string): Uint8Array {
  return strEncode(id);
}
export function openDecode(payload: Uint8Array): string {
  return strDecode(payload, 0).value;
}

export interface WorkOpened {
  handle: number; width: number; height: number; strata: number; edition: number;
  ceilingStratum: number; ceilingBands: number; seedWidth: number; seedHeight: number;
}
export function openedCore(a: WorkOpened): Uint8Array {
  return concat(
    viEncode(a.handle), viEncode(a.width), viEncode(a.height), [a.strata],
    viEncode(a.edition), [a.ceilingStratum, a.ceilingBands],
    viEncode(a.seedWidth), viEncode(a.seedHeight),
  );
}
export function openedDecode(payload: Uint8Array): WorkOpened {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const width = r.value; p = r.next;
  r = viDecode(payload, p); const height = r.value; p = r.next;
  const strata = u8At(payload, p); p += 1;
  r = viDecode(payload, p); const edition = r.value; p = r.next;
  const ceilingStratum = u8At(payload, p); const ceilingBands = u8At(payload, p + 1); p += 2;
  r = viDecode(payload, p); const seedWidth = r.value; p = r.next;
  r = viDecode(payload, p); const seedHeight = r.value; p = r.next;
  return { handle, width, height, strata, edition, ceilingStratum, ceilingBands, seedWidth, seedHeight };
}

/** MIRADA mflags (spec 3.3): bit 0 OCULTA, bit 1 QUIETA. */
export const MFLAGS_HIDDEN = 0x01;
export const MFLAGS_STILL = 0x02;

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
  let p = 0;
  const vals: number[] = [];
  for (let i = 0; i < 8; i++) {
    const r = viDecode(payload, p);
    vals.push(r.value);
    p = r.next;
  }
  return {
    handle: vals[0] ?? 0, seq: vals[1] ?? 0, x0: vals[2] ?? 0, y0: vals[3] ?? 0,
    x1: vals[4] ?? 0, y1: vals[5] ?? 0, vw: vals[6] ?? 0, vh: vals[7] ?? 0,
    flags: u8At(payload, p),
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
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  const minStratum = u8At(payload, p); const maxBands = u8At(payload, p + 1); const reason = u8At(payload, p + 2); p += 3;
  r = viDecode(payload, p); const maxBrushes = r.value; p = r.next;
  r = viDecode(payload, p); const maxKiB = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  return { handle, epoch, minStratum, maxBands, reason, maxBrushes, maxKiB, leaseS };
}

export type PlanMsg =
  | { handle: number; gazeSeq: number; event: 0; first: number; expectedCount: number; throttle: number }
  | { handle: number; gazeSeq: number; event: 1; last: number }
  | { handle: number; gazeSeq: number; event: 2; cancelled: number[] };
export function planCore(p: PlanMsg): Uint8Array {
  const head = concat(viEncode(p.handle), viEncode(p.gazeSeq), [p.event]);
  if (p.event === 0) return concat(head, viEncode(p.first), viEncode(p.expectedCount), [p.throttle]);
  if (p.event === 1) return concat(head, viEncode(p.last));
  return concat(head, rangesEncode(p.cancelled));
}
export function planDecode(payload: Uint8Array): PlanMsg {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const gazeSeq = r.value; p = r.next;
  const event = u8At(payload, p); p += 1;
  if (event === 0) {
    r = viDecode(payload, p); const first = r.value; p = r.next;
    r = viDecode(payload, p); const expectedCount = r.value; p = r.next;
    return { handle, gazeSeq, event, first, expectedCount, throttle: u8At(payload, p) };
  }
  if (event === 1) {
    r = viDecode(payload, p);
    return { handle, gazeSeq, event, last: r.value };
  }
  const rr = rangesDecode(payload, p);
  return { handle, gazeSeq, event: 2, cancelled: rr.values };
}

export interface Scrape { handle: number; order: number; epoch: number; through: number; predicate: number; params: Uint8Array }
export function scrapeCore(r: Scrape): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through), [r.predicate], r.params);
}
export function scrapeDecode(payload: Uint8Array): Scrape {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  const predicate = u8At(payload, p); p += 1;
  return { handle, order, epoch, through, predicate, params: payload.slice(p) };
}
export function scrapeParamsLowStratum(stratum: number): Uint8Array {
  return Uint8Array.from([stratum]);
}
export function scrapeParamsOutside(x0: number, y0: number, x1: number, y1: number): Uint8Array {
  return concat(viEncode(x0), viEncode(y0), viEncode(x1), viEncode(y1));
}
export function scrapeParamsBands(stratum: number, maxBands: number): Uint8Array {
  return Uint8Array.from([stratum, maxBands]);
}
export function scrapeParamsList(ranges: number[]): Uint8Array {
  return rangesEncode(ranges);
}

export interface Scraped {
  handle: number; order: number; epoch: number; through: number;
  scrapedCount: number; freedKib: number; kept: number[];
}
export function scrapedCore(r: Scraped): Uint8Array {
  return concat(
    viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through),
    viEncode(r.scrapedCount), viEncode(r.freedKib), rangesEncode(r.kept),
  );
}
export function scrapedDecode(payload: Uint8Array): Scraped {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const epoch = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  r = viDecode(payload, p); const scrapedCount = r.value; p = r.next;
  r = viDecode(payload, p); const freedKib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, epoch, through, scrapedCount, freedKib, kept: rr.values };
}

export interface Receipt { handle: number; completed: number[]; queueMs: number; free: number; renewThrough: number }
export function receiptCore(r: Receipt): Uint8Array {
  return concat(
    viEncode(r.handle), rangesEncode(r.completed), viEncode(r.queueMs),
    viEncode(r.free), viEncode(r.renewThrough),
  );
}
export function receiptDecode(payload: Uint8Array): Receipt {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const rr = rangesDecode(payload, p); p = rr.next;
  r = viDecode(payload, p); const queueMs = r.value; p = r.next;
  r = viDecode(payload, p); const free = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, completed: rr.values, queueMs, free, renewThrough: r.value };
}

export interface Release { handle: number; reason: number; ranges: number[] }
export function releaseCore(s: Release): Uint8Array {
  return concat(viEncode(s.handle), [s.reason], rangesEncode(s.ranges));
}
export function releaseDecode(payload: Uint8Array): Release {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  const reason = u8At(payload, p); p += 1;
  const rr = rangesDecode(payload, p);
  return { handle, reason, ranges: rr.values };
}

export interface Renew { handle: number; order: number; leaseS: number; ranges: number[] }
export function renewCore(r: Renew): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.leaseS), rangesEncode(r.ranges));
}
export function renewDecode(payload: Uint8Array): Renew {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const leaseS = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, leaseS, ranges: rr.values };
}

export interface Audit { handle: number; order: number; through: number }
export function auditCore(a: Audit): Uint8Array {
  return concat(viEncode(a.handle), viEncode(a.order), viEncode(a.through));
}
export function auditDecode(payload: Uint8Array): Audit {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p);
  return { handle, order, through: r.value };
}

export interface Inventory {
  handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[];
}
export function inventoryCore(v: Inventory): Uint8Array {
  return concat(
    viEncode(v.handle), viEncode(v.order), viEncode(v.through),
    viEncode(v.brushCount), viEncode(v.kib), rangesEncode(v.ranges),
  );
}
export function inventoryDecode(payload: Uint8Array): Inventory {
  let p = 0;
  let r = viDecode(payload, p); const handle = r.value; p = r.next;
  r = viDecode(payload, p); const order = r.value; p = r.next;
  r = viDecode(payload, p); const through = r.value; p = r.next;
  r = viDecode(payload, p); const brushCount = r.value; p = r.next;
  r = viDecode(payload, p); const kib = r.value; p = r.next;
  const rr = rangesDecode(payload, p);
  return { handle, order, through, brushCount, kib, ranges: rr.values };
}
