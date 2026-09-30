import { afterEach, describe, expect, it, vi } from 'vitest';
import { WsTransport } from '../ws';
import { makeBrushId, parseBrushHead, sliceBands, verifyBand } from '@/shared/proto/brush';
import { encodeFrame, splitAll } from '@/shared/proto/frame';
import { heartbeatCore, heartbeatDecode } from '@/shared/proto/messages/control';
import { T } from '@/shared/proto/messages/types';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { concat } from '@/shared/proto/varint';

const BAND = new Uint8Array([9, 8, 7, 6, 5, 4, 3]);
const NONCE = 0x1234n;

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  binaryType = '';
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((ev: { data: ArrayBuffer }) => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(): void {}
  close(): void {}
}

async function open(): Promise<{ t: WsTransport; push: (channel: number, body: Uint8Array) => ArrayBuffer }> {
  vi.stubGlobal('WebSocket', FakeSocket);
  const t = new WsTransport('ws://loopback');
  const ready = t.connect();
  const ws = FakeSocket.last as FakeSocket;
  ws.onopen?.();
  await ready;
  const push = (channel: number, body: Uint8Array): ArrayBuffer => {
    const data = concat([channel], body).buffer as ArrayBuffer;
    ws.onmessage?.({ data });
    return data;
  };
  return { t, push };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WsTransport.route', () => {
  it('hands a delivery on as a view at byteOffset 1 that parses, verifies and slices owned bands', async () => {
    const { t, push } = await open();
    const got: Uint8Array[] = [];
    t.onDelivery = (b) => got.push(b);
    const body = makeDeliveryBytes({ handle: 3, delivery: 42, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1, band: BAND });
    const data = push(1, body);
    const bytes = got[0] as Uint8Array;
    expect(bytes.byteOffset).toBe(1);
    expect(bytes.buffer).toBe(data); // no copy of the message
    expect(Array.from(bytes)).toEqual(Array.from(body));
    const h = parseBrushHead(bytes);
    expect(h.delivery).toBe(42);
    const band = sliceBands(bytes, h)[0] as Uint8Array;
    expect(verifyBand(band, h.crcs[0] ?? 0)).toBe(true);
    expect(Array.from(band)).toEqual(Array.from(BAND));
    // Bands own their buffer, so transferring band.buffer to a worker never moves the message.
    expect(band.byteOffset).toBe(0);
    expect(band.buffer.byteLength).toBe(BAND.length);
  });

  it('hands control frames on as a view that splitAll reads from its own offset', async () => {
    const { t, push } = await open();
    const got: Uint8Array[] = [];
    t.onControl = (f) => got.push(f);
    push(0, concat(encodeFrame(T.LATIDO, heartbeatCore(NONCE)), encodeFrame(T.ECO, heartbeatCore(NONCE + 1n))));
    const frame = got[0] as Uint8Array;
    expect(frame.byteOffset).toBe(1);
    const frames = splitAll(frame);
    expect(frames.map((f) => f.type)).toEqual([T.LATIDO, T.ECO]);
    expect(heartbeatDecode(frames[1]?.payload ?? new Uint8Array())).toBe(NONCE + 1n);
  });

  it('drops empty messages and unknown channels', async () => {
    const { t, push } = await open();
    const seen = vi.fn();
    t.onControl = seen;
    t.onDelivery = seen;
    (FakeSocket.last as FakeSocket).onmessage?.({ data: new ArrayBuffer(0) });
    push(2, new Uint8Array([1, 2]));
    expect(seen).not.toHaveBeenCalled();
  });
});
