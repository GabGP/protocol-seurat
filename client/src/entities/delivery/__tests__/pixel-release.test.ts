import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { PIXEL_RESTORE_WINDOW } from '@/shared/config/memory';
import type { SynthRequest } from '@/workers/protocol';
import type { DeliverySink } from '../sink/delivery-sink';
import type { SinkState } from '../sink/state';
import { fakeClient } from '../testing/fake-port';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';

const SEED = makeBrushId(10, 0, 0);
const MID = makeBrushId(9, 0, 0);
const LEAF = makeBrushId(8, 0, 0);
const THREE = 3;
const SETTLE_TICKS = 4;

const planes = (): ArrayBuffer[] => Array.from({ length: THREE }, () => new ArrayBuffer(8));
const tick = async (): Promise<void> => {
  for (let i = 0; i < SETTLE_TICKS; i++) await Promise.resolve();
};

let workers: FakeWorker[];
let sink: DeliverySink;
let client: ReturnType<typeof fakeClient>;
let closed: number;

function ingest(delivery: number, brushId: bigint): void {
  sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
}
const sent = (): SynthRequest[] => workers[0]!.sent;
const lastSent = (): SynthRequest => sent()[sent().length - 1]!;

async function answer(req: SynthRequest, withPlanes = true): Promise<void> {
  workers[0]!.answer({
    delivery: req.delivery, synthesisId: req.synthesisId, ok: true,
    rgba: new ArrayBuffer(4), planes: withPlanes ? planes() : null, width: 1, height: 1, elapsedMs: 1,
  });
  await tick();
}
const restoring = (): number => (sink as unknown as { s: SinkState }).s.restoring.size;
const rec = (d: number) => sink.book.byDelivery.get(d)!;

/** A seed, a mid brush and a leaf landed; the GPU took the mid brush and the leaf. */
async function landedAndUploaded(): Promise<void> {
  ingest(1, SEED);
  await answer(lastSent());
  ingest(2, MID);
  await answer(lastSent());
  ingest(3, LEAF);
  await answer(lastSent());
  sink.releasePixels(2, rec(2).image!);
  sink.releasePixels(3, rec(3).image!);
}

beforeEach(() => {
  closed = 0;
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: () => { closed++; } })));
  workers = [];
  client = fakeClient();
  sink = makeSink({ poolSize: 1, workers, client });
  sink.setExtent(16384, 16384);
});

afterEach(() => {
  sink.dispose();
  vi.unstubAllGlobals();
});

describe('releasePixels', () => {
  it('closes the bitmap and keeps the record, its bands and its image identity', async () => {
    await landedAndUploaded();
    expect(closed).toBe(2); // the mid brush and the leaf; the seed keeps its sketch
    const r = rec(3);
    expect(r.rgba).toBeNull();
    expect(r.image).toBeGreaterThan(0);
    expect(r.bands?.length).toBeGreaterThan(0);
    expect(sink.book.byDelivery.has(3)).toBe(true);
  });

  it('ignores a stale image, and never releases the seed sketch', async () => {
    ingest(1, SEED);
    await answer(lastSent());
    ingest(2, MID);
    await answer(lastSent());
    sink.releasePixels(2, rec(2).image! + 1);
    expect(rec(2).rgba).not.toBeNull();
    sink.releasePixels(1, rec(1).image!);
    expect(rec(1).rgba).not.toBeNull();
  });
});

describe('wantPixels: a local rebuild', () => {
  it('rebuilds a released brush from its bands, once however often it is asked', async () => {
    await landedAndUploaded();
    const before = sent().length;
    sink.wantPixels(3);
    sink.wantPixels(3);
    expect(sent().length - before).toBe(1);
    const req = lastSent();
    expect(req.restore).toBe(true);
    expect(req.delivery).toBe(3);
    await answer(req);
    expect(rec(3).rgba).not.toBeNull();
    expect(rec(3).image).toBeGreaterThan(0);
    sink.wantPixels(3); // it has pixels again: nothing to do
    expect(sent().length - before).toBe(1);
  });

  it('sends no second RECIBO, does not redo the children and keeps the book intact', async () => {
    await landedAndUploaded();
    sink.flushReceipt();
    const receipts = client.sentReceipt.length;
    const pendingReceipt = [...sink.book.pendingReceipt];
    const before = sent().length;
    sink.wantPixels(2); // the mid brush: the leaf hangs on it
    await answer(lastSent());
    expect(sent().length - before).toBe(1); // no resynthesis of the leaf
    sink.flushReceipt();
    expect(client.sentReceipt.length).toBe(receipts);
    expect(sink.book.pendingReceipt).toEqual(pendingReceipt);
    expect(client.sentRelease).toHaveLength(0);
  });

  it('parks behind its parent when the parent lost its planes, rebuilding them first', async () => {
    await landedAndUploaded();
    rec(2).planes = null;
    const before = sent().length;
    sink.wantPixels(3);
    const planesReq = sent()[before]!;
    expect(planesReq.planesOnly).toBe(true);
    expect(planesReq.delivery).toBe(2);
    await answer(planesReq);
    const restore = lastSent();
    expect(restore.restore).toBe(true);
    expect(restore.delivery).toBe(3);
    await answer(restore);
    expect(rec(3).rgba).not.toBeNull();
  });

  it('runs at most PIXEL_RESTORE_WINDOW at a time and drains the rest as they land', async () => {
    ingest(1, SEED);
    await answer(lastSent());
    const total = PIXEL_RESTORE_WINDOW + 2;
    for (let i = 0; i < total; i++) {
      ingest(10 + i, makeBrushId(9, i, 0));
      await answer(lastSent());
      sink.releasePixels(10 + i, rec(10 + i).image!);
    }
    const before = sent().length;
    for (let i = 0; i < total; i++) sink.wantPixels(10 + i);
    expect(restoring()).toBe(PIXEL_RESTORE_WINDOW);
    for (let i = 0; i < total; i++) {
      expect(restoring()).toBeLessThanOrEqual(PIXEL_RESTORE_WINDOW);
      await answer(lastSent());
    }
    expect(restoring()).toBe(0);
    expect(sent().length - before).toBe(total);
    for (let i = 0; i < total; i++) expect(rec(10 + i).rgba).not.toBeNull();
  });

  it('a failed restore frees its slot and leaves the record alone', async () => {
    await landedAndUploaded();
    sink.wantPixels(3);
    const req = lastSent();
    workers[0]!.answer({ delivery: 3, synthesisId: req.synthesisId, ok: false, error: 'boom', rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    await tick();
    expect(sink.book.byDelivery.has(3)).toBe(true);
    expect(rec(3).rgba).toBeNull();
    const before = sent().length;
    sink.wantPixels(3); // asked again later: tried again
    expect(sent().length - before).toBe(1);
  });

  it('drops the queued rebuild of a delivery that left the book', async () => {
    await landedAndUploaded();
    sink.wantPixels(3);
    sink.book.byDelivery.delete(3);
    await answer(lastSent());
    expect(rec(2).rgba).toBeNull();
    expect(client.sentRelease).toHaveLength(0);
  });
});
