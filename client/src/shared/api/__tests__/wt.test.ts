import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAZE_PER_S } from '@/shared/config/constants';
import { hexToBytes } from '@/shared/lib/hex';
import { encodeFrame } from '@/shared/proto/frame';
import { heartbeatCore } from '@/shared/proto/messages/control';
import { T } from '@/shared/proto/messages/types';
import { concat } from '@/shared/proto/varint';
import { WtTransport } from '../wt';

interface ServerCertHash {
  algorithm: string;
  value: Uint8Array;
}

interface WebTransportOptions {
  serverCertificateHashes?: ServerCertHash[];
}

class FakeWebTransport {
  static lastInstance: FakeWebTransport | null = null;
  static lastUrl: string | null = null;
  static lastOpts: WebTransportOptions | undefined = undefined;

  readonly ready = Promise.resolve();
  readonly closed: Promise<unknown>;
  resolveClosed!: (val?: unknown) => void;
  rejectClosed!: (err?: unknown) => void;
  datagrams: { writable: WritableStream<Uint8Array> } | null;
  bidiReadableController!: ReadableStreamDefaultController<Uint8Array>;
  writtenControl: Uint8Array[] = [];
  writtenDatagrams: Uint8Array[] = [];
  uniController!: ReadableStreamDefaultController<ReadableStream<Uint8Array>>;
  incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  closedCalled = false;

  constructor(url: string, opts?: WebTransportOptions) {
    FakeWebTransport.lastInstance = this;
    FakeWebTransport.lastUrl = url;
    FakeWebTransport.lastOpts = opts;

    this.closed = new Promise((res, rej) => {
      this.resolveClosed = res;
      this.rejectClosed = rej;
    });

    const dgStream = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writtenDatagrams.push(chunk);
      },
    });
    this.datagrams = { writable: dgStream };

    this.incomingUnidirectionalStreams = new ReadableStream<ReadableStream<Uint8Array>>({
      start: (c) => {
        this.uniController = c;
      },
    });
  }

  createBidirectionalStream(): Promise<{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }> {
    const readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.bidiReadableController = c;
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.writtenControl.push(chunk);
      },
    });
    return Promise.resolve({ readable, writable });
  }

  close(): void {
    this.closedCalled = true;
  }
}

beforeEach(() => {
  FakeWebTransport.lastInstance = null;
  FakeWebTransport.lastUrl = null;
  FakeWebTransport.lastOpts = undefined;
  vi.stubGlobal('WebTransport', FakeWebTransport);
  vi.stubGlobal('window', { WebTransport: FakeWebTransport });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WtTransport', () => {
  it('passes certificate hash options when provided, and undefined when absent', async () => {
    const hex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const wtWithHash = new WtTransport('https:host', hex);
    await wtWithHash.connect();
    expect(FakeWebTransport.lastOpts).toBeDefined();
    const hashes = FakeWebTransport.lastOpts?.serverCertificateHashes;
    expect(hashes).toBeDefined();
    expect(hashes?.[0]?.algorithm).toBe('sha-256');
    expect(hashes?.[0]?.value).toEqual(hexToBytes(hex));
    expect(hashes?.[0]?.value.byteLength).toBe(32);

    const wtWithoutHash = new WtTransport('https:host');
    await wtWithoutHash.connect();
    expect(FakeWebTransport.lastOpts).toBeUndefined();
  });

  it('reassembles control frames arriving split across multiple chunks', async () => {
    const t = new WtTransport('https:host');
    const received: Uint8Array[] = [];
    t.onControl = (frame) => received.push(frame);
    await t.connect();

    const fake = FakeWebTransport.lastInstance!;
    const f1 = encodeFrame(T.LATIDO, heartbeatCore(0x11n));
    const f2 = encodeFrame(T.ECO, heartbeatCore(0x22n));
    const combined = concat(f1, f2);

    const chunk1 = combined.slice(0, 3);
    const chunk2 = combined.slice(3, 9);
    const chunk3 = combined.slice(9);

    fake.bidiReadableController.enqueue(chunk1);
    fake.bidiReadableController.enqueue(chunk2);
    fake.bidiReadableController.enqueue(chunk3);

    await new Promise((r) => setTimeout(r, 10));

    expect(received.length).toBe(2);
    expect(Array.from(received[0]!)).toEqual(Array.from(f1));
    expect(Array.from(received[1]!)).toEqual(Array.from(f2));
  });

  it('accumulates chunks of a unidirectional stream into one delivery array', async () => {
    const t = new WtTransport('https:host');
    const deliveries: Uint8Array[] = [];
    t.onDelivery = (bytes) => deliveries.push(bytes);
    await t.connect();

    const fake = FakeWebTransport.lastInstance!;
    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7]);

    let uniStreamController!: ReadableStreamDefaultController<Uint8Array>;
    const uniStream = new ReadableStream<Uint8Array>({
      start: (c) => {
        uniStreamController = c;
      },
    });

    fake.uniController.enqueue(uniStream);
    uniStreamController.enqueue(chunk1);
    uniStreamController.enqueue(chunk2);
    uniStreamController.close();

    await new Promise((r) => setTimeout(r, 10));

    expect(deliveries.length).toBe(1);
    expect(Array.from(deliveries[0]!)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('writes sendControl and throttles sendGazeDatagram to GAZE_PER_S per second', async () => {
    const t = new WtTransport('https:host');
    await t.connect();

    const fake = FakeWebTransport.lastInstance!;
    const frame = new Uint8Array([1, 2, 3]);
    t.sendControl(frame);

    await new Promise((r) => setTimeout(r, 10));
    expect(fake.writtenControl.length).toBe(1);
    expect(Array.from(fake.writtenControl[0]!)).toEqual([1, 2, 3]);

    const gazePayload = new Uint8Array([9, 8, 7]);
    for (let i = 0; i < GAZE_PER_S + 5; i++) {
      t.sendGazeDatagram(gazePayload);
    }
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.writtenDatagrams.length).toBe(GAZE_PER_S);
  });

  it('calls onClose once when closed settles, and does not call onClose after close() was called', async () => {
    const t1 = new WtTransport('https:host');
    const closedReasons1: string[] = [];
    t1.onClose = (reason) => closedReasons1.push(reason);
    await t1.connect();

    const fake1 = FakeWebTransport.lastInstance!;
    fake1.resolveClosed();
    await new Promise((r) => setTimeout(r, 10));

    expect(closedReasons1).toEqual(['wt closed']);

    const t2 = new WtTransport('https:host');
    const closedReasons2: string[] = [];
    t2.onClose = (reason) => closedReasons2.push(reason);
    await t2.connect();

    const fake2 = FakeWebTransport.lastInstance!;
    t2.close();
    fake2.resolveClosed();
    await new Promise((r) => setTimeout(r, 10));

    expect(closedReasons2).toEqual([]);
    expect(fake2.closedCalled).toBe(true);
  });
});
