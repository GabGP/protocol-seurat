import { TlvTag } from '../../config/constants';
import { parseTlvs, tlvEncode } from '../frame';
import { teselasEncode } from '../teselas';
import { Reader } from '../reader';
import { concat, u64Encode, viEncode } from '../varint';

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

/** The RESUME ticket is a fixed 32 bytes (spec 3.4.4). */
const TICKET_BYTES = 32;

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
  for (const c of s.resume.claims) parts.push(viEncode(c.handle), teselasEncode(c.ranges));
  return [tlvEncode(TlvTag.RESUME, concat(...parts))];
}

function resumeDecode(value: Uint8Array): NonNullable<Hello['resume']> {
  const r = new Reader(value);
  const previousSession = r.u64();
  const ticket = r.take(TICKET_BYTES);
  const claims: ResumeClaim[] = [];
  for (let i = 0, n = r.vi(); i < n; i++) claims.push({ handle: r.vi(), ranges: r.teselas() });
  return { previousSession, ticket, claims };
}

export function helloDecode(payload: Uint8Array): Hello {
  const r = new Reader(payload);
  const minVersion = r.vi();
  const maxVersion = r.vi();
  const caps = r.vi();
  const memMib = r.vi();
  const token = r.take(r.vi());
  const out: Hello = { minVersion, maxVersion, caps, memMib, token };
  for (const t of parseTlvs(r.rest())) {
    if (t.tag === TlvTag.RESUME) out.resume = resumeDecode(t.value);
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
  const r = new Reader(payload);
  const out: Welcome = {
    version: r.vi(), caps: r.vi(), sessionId: r.u64(), lado: r.vi(), leaseS: r.vi(),
    heartbeatS: r.vi(), maxInFlight: r.vi(), sessionMaxBrushes: r.vi(),
    ticket: new Uint8Array(0), resumed: [],
  };
  for (const t of parseTlvs(r.rest())) {
    if (t.tag === TlvTag.TICKET) out.ticket = t.value;
    else if (t.tag === TlvTag.RESUMED) {
      const v = new Reader(t.value);
      for (let i = 0, n = v.vi(); i < n; i++) out.resumed.push(v.vi());
    }
  }
  return out;
}
