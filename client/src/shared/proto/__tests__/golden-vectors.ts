import { concat, viEncode } from '@/shared/proto/varint';
import {
  T,
  welcomeCore,
  welcomeTlvs,
  concessionCore,
  gazeCore,
  planCore,
  scrapedCore,
  receiptCore,
  renewCore,
  helloCore,
  helloTlvs,
} from '@/shared/proto/messages';
import { encodeFrame } from '@/shared/proto/frame';

export function token32(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (0xde + i * 31) & 0xff;
  return out;
}

export function ticket32(): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (0x7a + i * 17) & 0xff;
  return out;
}

export function rangeList(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let n = lo; n <= hi; n++) out.push(n);
  return out;
}

export const SESSION_ID = 0x3a915e0c77d214b8n;

export const VECTORS = {
  helloFrame(): Uint8Array {
    const core = helloCore({ minVersion: 1, maxVersion: 1, caps: 3, memMib: 256, token: token32() });
    return encodeFrame(T.SALUDO, core);
  },
  bienvenidaFrame(): Uint8Array {
    const b = {
      version: 1, caps: 3, sessionId: SESSION_ID, lado: 256, leaseS: 120,
      heartbeatS: 15, maxInFlight: 12, sessionMaxBrushes: 1024, ticket: ticket32(), resumed: [] as number[],
    };
    return encodeFrame(T.BIENVENIDA, welcomeCore(b), welcomeTlvs(b));
  },
  gazeDatagram(): Uint8Array {
    return concat(
      viEncode(T.MIRADA),
      gazeCore({ handle: 1, seq: 8, x0: 65536, y0: 49152, x1: 69376, y1: 51312, vw: 1920, vh: 1080, flags: 0 }),
    );
  },
  concessionSketch(): Uint8Array {
    return encodeFrame(T.CONCESION, concessionCore({
      handle: 1, epoch: 1, minStratum: 7, maxBands: 4, reason: 0,
      maxBrushes: 768, maxKiB: 36864, leaseS: 120,
    }));
  },
  planInicio(): Uint8Array {
    return encodeFrame(T.PLAN, planCore({ handle: 1, gazeSeq: 8, event: 0, first: 45, expectedCount: 212, throttle: 0 }));
  },
  receipt(): Uint8Array {
    return encodeFrame(T.RECIBO, receiptCore({
      handle: 1, completed: [...rangeList(45, 51), ...rangeList(53, 60)],
      queueMs: 40, free: 708, renewThrough: 0,
    }));
  },
  scrapedFull(): Uint8Array {
    return encodeFrame(T.RASPADO, scrapedCore({
      handle: 1, order: 3, epoch: 3, through: 289, scrapedCount: 28, freedKib: 216, kept: rangeList(1, 256),
    }));
  },
  renew(): Uint8Array {
    return encodeFrame(T.RENOVAR, renewCore({
      handle: 1, order: 12, leaseS: 120, ranges: [...rangeList(1, 256), ...rangeList(290, 336)],
    }));
  },
  helloResume(): Uint8Array {
    const s = {
      minVersion: 1, maxVersion: 1, caps: 3, memMib: 256, token: token32(),
      resume: {
        previousSession: SESSION_ID, ticket: ticket32(),
        claims: [{ handle: 1, ranges: [...rangeList(1, 256), ...rangeList(290, 336)] }],
      },
    };
    return encodeFrame(T.SALUDO, helloCore(s), helloTlvs(s));
  },
};
