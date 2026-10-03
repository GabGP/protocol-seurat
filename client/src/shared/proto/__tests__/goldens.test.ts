import { describe, expect, it } from 'vitest';
import { concat, u64Decode, u64Encode, viDecode, viDecodeBig, viEncode } from '@/shared/proto/varint';
import { setsEqual, teselasDecode, teselasEncode } from '@/shared/proto/teselas';
import { decodeFrame, encodeFrame, FatalProtocolError } from '@/shared/proto/frame';
import {
  T,
  welcomeDecode,
  concessionDecode,
  gazeDecode,
  planDecode,
  scrapedDecode,
  receiptCore,
  receiptDecode,
  renewDecode,
  helloCore,
  helloDecode,
} from '@/shared/proto/messages';
import { bytesToHex as hex } from '@/shared/lib/hex';
import { parseBrushHead, makeBrushId, splitBrushId } from '@/shared/proto/brush';
import { rangeList, SESSION_ID, ticket32, VECTORS } from './golden-vectors';

describe('varint (QUIC minimal encode)', () => {
  it('encodes RFC vectors', () => {
    expect(hex(Uint8Array.from(viEncode(37)))).toBe('25');
    expect(hex(Uint8Array.from(viEncode(15293)))).toBe('7bbd');
    expect(hex(Uint8Array.from(viEncode(494878333)))).toBe('9d7f3e7d');
    expect(hex(Uint8Array.from(viEncode(151288809941952652n)))).toBe('c2197c5eff14e88c');
    expect(viDecodeBig(Uint8Array.from([0xc2, 0x19, 0x7c, 0x5e, 0xff, 0x14, 0xe8, 0x8c]), 0).value).toBe(
      151288809941952652n,
    );
  });
  it('accepts non-minimal 0x4025 = 37', () => {
    const r = viDecode(Uint8Array.from([0x40, 0x25]), 0);
    expect(r.value).toBe(37);
    expect(r.next).toBe(2);
  });
  it('round-trips boundaries', () => {
    for (const v of [0, 63, 64, 16383, 16384, 1073741823, 1073741824, 2 ** 40]) {
      expect(viDecode(Uint8Array.from(viEncode(v)), 0).value).toBe(v);
    }
  });
  it('u64 big-endian', () => {
    const r = u64Decode(Uint8Array.from(u64Encode(0x3a915e0c77d214b8n)), 0);
    expect(r.value).toBe(0x3a915e0c77d214b8n);
  });
});

describe('Teselas sets (ADR-09)', () => {
  it('empty set = 0000', () => {
    expect(hex(teselasEncode([]))).toBe('0000');
    const r = teselasDecode(Uint8Array.from([0x00, 0x00]), 0);
    expect(r.values).toEqual([]);
    expect(r.next).toBe(2);
  });
  it('RECIBO with nothing new = 01 0000 28 42c4 00', () => {
    const r = { handle: 1, completed: [], queueMs: 40, free: 708, renewThrough: 0 };
    expect(hex(receiptCore(r))).toBe('0100002842c400');
    expect(receiptDecode(receiptCore(r))).toEqual(r);
  });
  it('RECIBO [45,51]+[53,60] = 2d 01 06 00 07', () => {
    const enc = teselasEncode([...rangeList(45, 51), ...rangeList(53, 60)]);
    expect(hex(enc)).toBe('2d01060007');
    expect(teselasDecode(enc, 0).values).toEqual([...rangeList(45, 51), ...rangeList(53, 60)]);
  });
  it('RASPADO [1,256] = 01 00 40 ff', () => {
    const enc = teselasEncode(rangeList(1, 256));
    expect(hex(enc)).toBe('010040ff');
  });
  it('exact equality', () => {
    expect(setsEqual([1, 2, 3], [3, 2, 1])).toBe(true);
    expect(setsEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe('frame rules', () => {
  it('rejects frames over 64 KiB', () => {
    expect(() => encodeFrame(0x01, new Uint8Array(65537))).toThrow(FatalProtocolError);
  });
  it('unknown mandatory type is fatal ERROR 1', () => {
    const raw = concat(viEncode(0x09), viEncode(1), new Uint8Array([0]));
    expect(() => decodeFrame(raw, () => -1)).toThrow(FatalProtocolError);
  });
  it('optional type >= 0x40 is skipped', () => {
    const raw = concat(viEncode(0x40), viEncode(1), new Uint8Array([0]));
    expect(decodeFrame(raw, () => -1)).toBeNull();
  });
  it('unknown TLV tags are skipped', () => {
    const token = new Uint8Array(32).fill(7);
    const core = helloCore({ minVersion: 1, maxVersion: 1, caps: 3, memMib: 256, token });
    const extra = concat(viEncode(0x7f), viEncode(2), new Uint8Array([1, 2]));
    const raw = encodeFrame(T.SALUDO, core, [extra]);
    const f = decodeFrame(raw, () => core.length);
    expect(f?.tlvs.length).toBe(1);
    expect(helloDecode(concat(core, extra)).token).toEqual(token);
  });
});

describe('spec 3.4 goldens', () => {
  it('SALUDO core is 38 bytes with exact prefix', () => {
    const frame = VECTORS.helloFrame();
    const core = frame.slice(2);
    expect(core.length).toBe(38);
    expect(hex(core.slice(0, 6))).toBe('010103410020');
    expect(frame.length).toBe(40);
    expect(hex(frame.slice(0, 2))).toBe('0126');
    expect(helloDecode(core)).toMatchObject({ minVersion: 1, maxVersion: 1, caps: 3, memMib: 256 });
  });
  it('BIENVENIDA payload is 52 bytes', () => {
    const frame = VECTORS.bienvenidaFrame();
    const payload = frame.slice(2);
    expect(payload.length).toBe(52);
    expect(hex(frame.slice(0, 2))).toBe('0234');
    const back = welcomeDecode(payload);
    expect(back.sessionId).toBe(SESSION_ID);
    expect(back.ticket).toEqual(ticket32());
  });
  it('MIRADA datagram is 24 bytes exact', () => {
    const dg = VECTORS.gazeDatagram();
    expect(dg.length).toBe(24);
    expect(hex(dg)).toBe('200108800100008000c00080010f008000c8704780443800');
    expect(gazeDecode(dg.slice(1))).toMatchObject({ handle: 1, seq: 8, x0: 65536, vw: 1920, flags: 0 });
  });
  it('CONCESION sketch exact bytes', () => {
    const frame = VECTORS.concessionSketch();
    expect(hex(frame)).toBe('210d01010704004300800090004078');
    expect(concessionDecode(frame.slice(2))).toMatchObject({ epoch: 1, minStratum: 7, maxBands: 4 });
  });
  it('PLAN INICIO first 45 expectedCount 212 exact', () => {
    const frame = VECTORS.planInicio();
    expect(hex(frame)).toBe('23070108002d40d400');
    expect(planDecode(frame.slice(2))).toMatchObject({ event: 0, first: 45, expectedCount: 212 });
  });
  it('RECIBO [45,51]+[53,60] exact', () => {
    const frame = VECTORS.receipt();
    expect(hex(frame)).toBe('260a012d010600072842c400');
    const back = receiptDecode(frame.slice(2));
    expect(back.completed.length).toBe(15);
    expect(back).toMatchObject({ queueMs: 40, free: 708 });
  });
  it('RASPADO [1,256] exact (ADR-09)', () => {
    const frame = VECTORS.scrapedFull();
    expect(hex(frame)).toBe('250c01030341211c40d8010040ff');
    const back = scrapedDecode(frame.slice(2));
    expect(back).toMatchObject({ order: 3, epoch: 3, through: 289, scrapedCount: 28, freedKib: 216 });
    expect(back.kept.length).toBe(rangeList(1, 256).length);
  });
  it('RENOVAR exact', () => {
    const frame = VECTORS.renew();
    expect(hex(frame)).toBe('280a010c4078010140ff202e');
    expect(renewDecode(frame.slice(2))).toMatchObject({ order: 12, leaseS: 120 });
  });
  it('SALUDO REANUDAR largo 88 with TLV 0x01/0x30', () => {
    const frame = VECTORS.helloResume();
    expect(hex(frame.slice(0, 3))).toBe('014058');
    expect(frame.length).toBe(3 + 88);
    const back = helloDecode(frame.slice(3));
    expect(back.resume?.claims[0]?.ranges.length).toBe(303);
  });
});

describe('brush header', () => {
  it('parses delivery 64 P(1,131,98)', () => {
    const head = concat(
      viEncode(0x01), viEncode(1), viEncode(64),
      (() => {
        const b = new Uint8Array(8);
        const v = new DataView(b.buffer);
        v.setBigUint64(0, 0x010000000000680dn);
        return b;
      })(),
      new Uint8Array([0x02]), viEncode(2), new Uint8Array([4, 6]), viEncode(2),
      new Uint8Array([0x64, 0x7c, 0xbe, 0x67, 0x07, 0x62, 0x9c, 0x02]),
      viEncode(6496), viEncode(5873),
    );
    const h = parseBrushHead(head);
    expect(h.delivery).toBe(64);
    expect(h.brushId).toBe(0x010000000000680dn);
    expect([h.from, h.through]).toEqual([0, 2]);
    expect(h.epoch).toBe(2);
    expect([h.qY, h.qC]).toEqual([4, 6]);
    expect(h.lengths).toEqual([6496, 5873]);
    const parts = splitBrushId(h.brushId);
    expect(parts).toMatchObject({ stratum: 1, bx: 131, by: 98 });
    expect(makeBrushId(1, 131, 98)).toBe(0x010000000000680dn);
  });
});
