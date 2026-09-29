import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brushKey, makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { STALE_PARENT, type SynthRequest } from '@/workers/protocol';
import type { DeliverySink } from '../sink/delivery-sink';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';

const SEED = makeBrushId(10, 0, 0);
const MID = makeBrushId(9, 0, 0);
const LEAF = makeBrushId(8, 0, 0);
const THREE = 3;
const SETTLE_TICKS = 3;

const planes = (): ArrayBuffer[] => Array.from({ length: THREE }, () => new ArrayBuffer(8));
const tick = async (): Promise<void> => {
  for (let i = 0; i < SETTLE_TICKS; i++) await Promise.resolve();
};

let workers: FakeWorker[];
let sink: DeliverySink;

function ingest(delivery: number, brushId: bigint): void {
  sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
}

/** The last request the single fake worker was given. */
const lastSent = (): SynthRequest => workers[0]!.sent[workers[0]!.sent.length - 1]!;

/** A synthesized image: the bitmap and planes of `req`. */
async function land(req: SynthRequest): Promise<void> {
  workers[0]!.answer({
    delivery: req.delivery, synthesisId: req.synthesisId, ok: true,
    rgba: new ArrayBuffer(4), planes: planes(), width: 1, height: 1, elapsedMs: 1,
  });
  await tick();
}

/** A planes-only answer: no image. */
async function landPlanes(req: SynthRequest): Promise<void> {
  workers[0]!.answer({
    delivery: req.delivery, synthesisId: req.synthesisId, ok: true,
    rgba: null, planes: planes(), width: 1, height: 1, elapsedMs: 1,
  });
  await tick();
}

/** A seed and its child landed with planes; the child's planes are then dropped (as a cold cone would). */
async function seedAndStrippedChild(): Promise<void> {
  ingest(1, SEED);
  await land(lastSent());
  ingest(2, MID);
  await land(lastSent());
  sink.book.byDelivery.get(2)!.planes = null;
}

beforeEach(() => {
  vi.stubGlobal('ImageData', class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
  workers = [];
  sink = makeSink({ poolSize: 1, workers });
  sink.setExtent(16384, 16384);
});

afterEach(() => {
  sink.dispose();
  vi.unstubAllGlobals();
});

describe('planes are kept only where a child can come', () => {
  it('a brush at min_estrato keeps none, a coarser one keeps its planes', async () => {
    sink.concede({ epoch: 1, minStratum: 9, maxBands: 4 });
    ingest(1, SEED);
    await land(lastSent());
    ingest(2, MID);
    await land(lastSent());
    expect(sink.book.byDelivery.get(1)?.planes).toHaveLength(THREE);
    expect(sink.book.byDelivery.get(2)?.planes).toBeNull();
  });
});

describe('dropColdPlanes', () => {
  it('keeps the cone, the seed and the sketch strata, and drops the planes of far brushes', () => {
    const held: Array<[number, bigint]> = [
      [1, makeBrushId(0, 0, 0)], [2, makeBrushId(0, 40, 40)], [3, makeBrushId(5, 0, 0)],
      [4, makeBrushId(5, 20, 20)], [5, makeBrushId(7, 50, 50)], [6, SEED],
    ];
    for (const [delivery, brushId] of held) {
      sink.book.byDelivery.set(delivery, {
        delivery, brushId, stratum: Number(brushId >> 56n), from: 0, through: 4, bytes: 10,
        epoch: 1, edition: 1, expires: 1e12, rgba: null, planes: planes(),
      });
    }
    sink.setView(0, 0, 512, 512, 512, 512);
    const kept = held.filter(([d]) => sink.book.byDelivery.get(d)?.planes).map(([d]) => d);
    expect(kept).toEqual([1, 3, 5, 6]);
  });

  it('bumps the revision the paint caches key on only when it dropped something', () => {
    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(0, 40, 40), stratum: 0, from: 0, through: 4, bytes: 10,
      epoch: 1, edition: 1, expires: 1e12, rgba: null, planes: planes(),
    });
    const before = sink.revision;
    sink.setView(0, 0, 512, 512, 512, 512);
    const dropped = sink.revision;
    sink.setView(0, 0, 512, 512, 512, 512);
    expect(dropped).toBeGreaterThan(before);
    expect(sink.revision).toBe(dropped);
  });
});

describe('a child whose parent lost its planes', () => {
  it('waits for a planes-only rebuild of the parent, then is synthesized; the parent image is untouched', async () => {
    await seedAndStrippedChild();
    const parent = sink.book.byDelivery.get(2)!;
    const bitmap = parent.rgba;
    const queued = sink.book.pendingReceipt.length;
    ingest(3, LEAF);
    const rebuild = lastSent();
    expect(rebuild).toMatchObject({ delivery: 2, planesOnly: true, keep: true, seed: false });
    expect(rebuild.parentRef ?? rebuild.parentPlanes).toBeDefined(); // seeded by the seed's planes
    expect(workers[0]!.sent.some((r) => r.delivery === 3)).toBe(false); // the child waits
    await landPlanes(rebuild);
    expect(parent.planes).toHaveLength(THREE);
    expect(parent.rgba).toBe(bitmap);
    expect(sink.book.pendingReceipt.length).toBe(queued);
    const child = lastSent();
    expect(child.delivery).toBe(3);
    expect(child.planesOnly).toBeUndefined();
    expect(child.parentKey).toBe(brushKey(MID, 1));
    await land(child);
    expect(sink.book.byDelivery.get(3)?.rgba).not.toBeNull();
    expect(sink.book.byDelivery.get(3)?.pending).toBe(false);
  });

  it('asks for one rebuild however many children wait', async () => {
    await seedAndStrippedChild();
    ingest(3, LEAF);
    ingest(4, makeBrushId(8, 1, 0));
    const rebuilds = workers[0]!.sent.filter((r) => r.planesOnly);
    expect(rebuilds).toHaveLength(1);
    await landPlanes(rebuilds[0]!);
    const sent = workers[0]!.sent.filter((r) => !r.planesOnly).map((r) => r.delivery);
    expect(sent).toContain(3);
  });

  it('a failed rebuild fails only the waiting child, never the parent', async () => {
    await seedAndStrippedChild();
    ingest(3, LEAF);
    const rebuild = lastSent();
    workers[0]!.answer({ delivery: 2, synthesisId: rebuild.synthesisId, ok: false, rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    await tick();
    expect(sink.book.byDelivery.has(3)).toBe(false);
    expect(sink.book.byDelivery.has(2)).toBe(true);
    expect(sink.book.byDelivery.get(2)?.rgba).not.toBeNull();
    expect(sink.book.byDelivery.has(1)).toBe(true);
  });

  it('a cache miss on a stripped parent rebuilds it instead of failing the child', async () => {
    ingest(1, SEED);
    await land(lastSent());
    ingest(2, MID);
    const byRef = lastSent();
    expect(byRef.delivery).toBe(2);
    sink.book.byDelivery.get(1)!.planes = null; // dropped while the child was in flight
    workers[0]!.answer({ delivery: 2, synthesisId: byRef.synthesisId, ok: false, error: STALE_PARENT, rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    await tick();
    expect(sink.book.byDelivery.has(2)).toBe(true);
    const rebuild = lastSent();
    expect(rebuild).toMatchObject({ delivery: 1, planesOnly: true });
    await landPlanes(rebuild);
    const retry = lastSent();
    expect(retry.delivery).toBe(2);
    // the rebuild retained the planes in the worker, so the child goes by reference to them
    expect(retry.parentRef).toBe(retry.parentKey);
    expect(retry.bands.every((b) => b.byteLength > 0)).toBe(true);
  });
});

describe('removeDelivery', () => {
  it('nulls the planes and bands of the record that leaves', async () => {
    ingest(1, SEED);
    const rec = sink.book.byDelivery.get(1)!;
    rec.planes = planes();
    const req = lastSent();
    workers[0]!.answer({ delivery: 1, synthesisId: req.synthesisId, ok: false, rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    await tick();
    expect(sink.book.byDelivery.has(1)).toBe(false);
    expect(rec.planes).toBeNull();
    expect(rec.bands).toEqual([]);
  });
});
