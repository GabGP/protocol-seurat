import { describe, expect, it, vi } from 'vitest';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { makeBrushId, brushKey } from '@/shared/proto/brush';
import type { SessionClient } from '@/app/providers/session-client';
import type { SynthRequest } from '@/workers/protocol';
import { STALE_PARENT } from '@/workers/protocol';

function fakeClient() {
  const c = {
    sendRelease() {},
    sendScraped() {},
    sendReceipt() {},
    sendInventory() {},
  };
  return c as unknown as SessionClient;
}

function makeDeliveryBytes(opts: {
  handle: number;
  delivery: number;
  brushId: bigint;
  from: number;
  through: number;
  epoch: number;
}): Uint8Array {
  const band = new Uint8Array([10, 20, 30, 40, 50]);
  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, opts.brushId);
  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crc32c(band));
  const head = concat(
    viEncode(0x01),
    viEncode(opts.handle),
    viEncode(opts.delivery),
    bIdBuf,
    new Uint8Array([((opts.from & 0xf) << 4) | (opts.through & 0xf)]),
    viEncode(opts.epoch),
    new Uint8Array([4, 6]),
    viEncode(1),
    crcBuf,
    viEncode(band.length),
  );
  return concat(head, band);
}

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: SynthRequest[] = [];
  terminated = false;
  postMessage(req: SynthRequest, _options: { transfer: Transferable[] }): void {
    this.sent.push(req);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function makeSink(poolSize: number, workers: FakeWorker[]): DeliverySink {
  return new DeliverySink(1, () => fakeClient(), () => 36864, () => 768, 192, 160, 11, poolSize, () => {
    const w = new FakeWorker();
    workers.push(w);
    return w;
  });
}

describe('DeliverySink pool', () => {
  it('fans out over idle workers, holds the rest, refills on completion', async () => {
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const workers: FakeWorker[] = [];
    const sink = makeSink(2, workers);
    const seed = makeBrushId(10, 0, 0);
    const ingest = (delivery: number): void => {
      sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId: seed, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    };
    ingest(1);
    ingest(2);
    ingest(3);
    expect(workers.length).toBe(2);
    expect(workers[0]?.sent.map((r) => r.delivery)).toEqual([1]);
    expect(workers[1]?.sent.map((r) => r.delivery)).toEqual([2]);
    expect(sink.queueDepthMs).toBeCloseTo(7.5, 5);
    workers[0]?.answer({ delivery: 1, synthesisId: 1, ok: true,
      rgba: new ArrayBuffer(4), planes: [new ArrayBuffer(8)], width: 1, height: 1, elapsedMs: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(workers[0]?.sent.map((r) => r.delivery)).toEqual([1, 3]);
    sink.dispose();
    expect(workers.every((w) => w.terminated)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('runs the newest epoch first when a worker frees', () => {    const workers: FakeWorker[] = [];
    const sink = makeSink(1, workers);
    const seed = makeBrushId(10, 0, 0);
    const ingest = (delivery: number, epoch: number): void => {
      sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId: seed, from: 0, through: 1, epoch }), () => 1000, () => {}, 120);
    };
    ingest(1, 1);
    ingest(2, 1);
    ingest(3, 2);
    workers[0]?.answer({ delivery: 1, synthesisId: 1, ok: false, rgba: null, planes: null, width: 0, height: 0, elapsedMs: 5 });
    expect(workers[0]?.sent.map((r) => r.delivery)).toEqual([1, 3]);
    sink.dispose();
    expect(workers[0]?.terminated).toBe(true);
  });

  it('routes children to the parent worker by reference, retries with bytes on miss', async () => {
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const workers: FakeWorker[] = [];
    const sink = makeSink(2, workers);
    const seed = makeBrushId(10, 0, 0);
    const child = makeBrushId(9, 0, 0);
    const ingest = (delivery: number, brushId: bigint): void => {
      sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    };
    ingest(1, seed);
    workers[0]?.answer({ delivery: 1, synthesisId: 1, ok: true,
      rgba: new ArrayBuffer(4), planes: [new ArrayBuffer(8), new ArrayBuffer(8), new ArrayBuffer(8)], width: 1, height: 1, elapsedMs: 5 });
    await Promise.resolve();
    await Promise.resolve();
    ingest(2, child);
    expect(sink.synthLoad).toEqual({ size: 2, busy: 1, waiting: 0 });
    const sent = workers[0]?.sent[1];
    expect(sent?.delivery).toBe(2);
    expect(sent?.parentRef).toBe(brushKey(seed, 1));
    expect(sent?.parentPlanes).toBeUndefined();
    workers[0]?.answer({ delivery: 2, synthesisId: 2, ok: false, error: STALE_PARENT,
      rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    const retry = workers[0]?.sent[2];
    expect(retry?.delivery).toBe(2);
    expect(retry?.parentRef).toBeUndefined();
    expect(retry?.parentPlanes).toHaveLength(3);
    workers[0]?.answer({ delivery: 2, synthesisId: 2, ok: true,
      rgba: new ArrayBuffer(4), planes: [new ArrayBuffer(8)], width: 1, height: 1, elapsedMs: 5 });
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.book.byDelivery.get(2)?.pending).toBe(false);
    sink.dispose();
    expect(sink.synthLoad).toEqual({ size: 0, busy: 0, waiting: 0 });
    expect(workers.every((w) => w.terminated)).toBe(true);
    vi.unstubAllGlobals();
  });
});
