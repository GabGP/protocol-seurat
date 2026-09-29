import { describe, expect, it, vi } from 'vitest';
import { makeBrushId, brushKey } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';
import { STALE_PARENT } from '@/workers/protocol';

describe('DeliverySink pool', () => {
  it('fans out over idle workers, holds the rest, refills on completion', async () => {
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const workers: FakeWorker[] = [];
    const sink = makeSink({ poolSize: 2, workers: workers });
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
    const sink = makeSink({ poolSize: 1, workers: workers });
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
    const sink = makeSink({ poolSize: 2, workers: workers });
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
    structuredClone(sent?.bands, { transfer: sent?.bands }); // postMessage detached them
    workers[0]?.answer({ delivery: 2, synthesisId: 2, ok: false, error: STALE_PARENT,
      rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    const retry = workers[0]?.sent[2];
    expect(retry?.delivery).toBe(2);
    expect(retry?.parentRef).toBeUndefined();
    expect(retry?.parentPlanes).toHaveLength(3);
    expect(retry?.bands.every((b) => b.byteLength > 0)).toBe(true); // fresh copies, not the detached ones
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
