import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANES_HELD_MAX, PLANES_READOUT_KEEP } from '@/shared/config/memory';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { STALE_PARENT, type SynthRequest } from '@/workers/protocol';
import type { DeliverySink } from '../sink/delivery-sink';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';

const THREE = 3;
const SETTLE_TICKS = 3;
const VIEW = 512;
const WIDE_VIEW = 4096;
const WIDE_SIDE = 12;
const FAR_VIEW = 400000;
/** A chain of ancestors far from a view at the origin: none of it lies in the current cone. */
const FAR = [makeBrushId(10, 0, 0), makeBrushId(9, 12, 12), makeBrushId(8, 25, 25), makeBrushId(7, 50, 50)];
const FAR_CHILD = makeBrushId(6, 100, 100);

const planes = (): ArrayBuffer[] => Array.from({ length: THREE }, () => new ArrayBuffer(8));
const tick = async (): Promise<void> => {
  for (let i = 0; i < SETTLE_TICKS; i++) await Promise.resolve();
};

let workers: FakeWorker[];
let sink: DeliverySink;

const lastSent = (): SynthRequest => workers[0]!.sent[workers[0]!.sent.length - 1]!;
const planesOf = (delivery: number): ArrayBuffer[] | null | undefined => sink.book.byDelivery.get(delivery)?.planes;

function ingest(delivery: number, brushId: bigint): void {
  sink.ingest(makeDeliveryBytes({ handle: 1, delivery, brushId, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
}

async function answer(req: SynthRequest, image: boolean): Promise<void> {
  workers[0]!.answer({
    delivery: req.delivery, synthesisId: req.synthesisId, ok: true,
    rgba: image ? new ArrayBuffer(4) : null, planes: planes(), width: 1, height: 1, elapsedMs: 1,
  });
  await tick();
}

/** The whole far chain landed (the view is at the origin, focus 0). */
async function landFarChain(): Promise<void> {
  sink.setView(0, 0, VIEW, VIEW, VIEW, VIEW);
  for (const [i, brushId] of FAR.entries()) {
    ingest(i + 1, brushId);
    await answer(lastSent(), true);
  }
}

function hold(delivery: number, brushId: bigint): void {
  sink.book.byDelivery.set(delivery, {
    delivery, brushId, stratum: Number(brushId >> 56n), from: 0, through: 4, bytes: 10,
    epoch: 1, edition: 1, expires: 1e12, rgba: null, planes: planes(),
  });
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

describe('planes are held only while a child can be pending', () => {
  it('a landed brush outside the current cone keeps none, the roots keep theirs', async () => {
    await landFarChain();
    expect(planesOf(1)).toHaveLength(THREE); // the seed
    expect(planesOf(2)).toHaveLength(THREE);
    expect(planesOf(3)).toHaveLength(THREE); // the three coarsest strata are roots
    expect(planesOf(4)).toBeNull(); // stratum 7, far from the cone
  });

  it('a brush with children held gives its planes back once the view leaves it', () => {
    hold(1, makeBrushId(5, 0, 0));
    hold(2, makeBrushId(4, 0, 0));
    sink.book.childrenOf.set(1, new Set([2]));
    sink.setView(0, 0, VIEW, VIEW, VIEW, VIEW);
    expect(planesOf(1)).toHaveLength(THREE); // in the cone above the focus
    sink.setView(FAR_VIEW, FAR_VIEW, FAR_VIEW + VIEW, FAR_VIEW + VIEW, VIEW, VIEW);
    expect(planesOf(1)).toBeNull();
    expect(planesOf(2)).toBeNull();
  });

  it('holds at most PLANES_HELD_MAX spare planes, the ones nearest the view', () => {
    for (let by = 0; by < WIDE_SIDE; by++) for (let bx = 0; bx < WIDE_SIDE; bx++) hold(by * WIDE_SIDE + bx + 1, makeBrushId(1, bx, by));
    sink.setView(0, 0, WIDE_VIEW, WIDE_VIEW, WIDE_VIEW, WIDE_VIEW);
    const kept = [...sink.book.byDelivery.values()].filter((r) => r.planes);
    expect(kept).toHaveLength(PLANES_HELD_MAX);
    expect(planesOf(WIDE_SIDE * WIDE_SIDE)).toBeNull(); // the far corner
    expect(planesOf(4 * WIDE_SIDE + 4 + 1)).toHaveLength(THREE); // the middle
  });

  it('keeps the planes asked for a pixel readout, the last few only', () => {
    for (let i = 1; i <= PLANES_READOUT_KEEP + 2; i++) hold(i, makeBrushId(0, 100 + i, 100));
    for (let i = 1; i <= PLANES_READOUT_KEEP + 2; i++) sink.wantPlanes(i);
    sink.setView(0, 0, VIEW, VIEW, VIEW, VIEW);
    const kept = [...sink.book.byDelivery.values()].filter((r) => r.planes).map((r) => r.delivery);
    expect(kept).toEqual([3, 4, 5, 6]);
  });
});

describe('a zoom-in on a parent held nowhere', () => {
  it('rebuilds its planes, sends the child, and holds none of them afterwards', async () => {
    await landFarChain();
    ingest(5, FAR_CHILD);
    const rebuild = lastSent();
    expect(rebuild).toMatchObject({ delivery: 4, planesOnly: true, keep: true });
    expect(workers[0]!.sent.some((r) => r.delivery === 5)).toBe(false);
    await answer(rebuild, false);
    const child = lastSent();
    expect(child.delivery).toBe(5);
    expect(child.parentKey).toBeDefined();
    expect(planesOf(4)).toBeNull(); // the child took its copy (or reference): nothing waits on them here
    await answer(child, true);
    expect(sink.book.byDelivery.get(5)?.rgba).not.toBeNull();
    expect(planesOf(5)).toBeNull();
  });

  it('a worker cache miss rebuilds again and then sends bytes, never another reference', async () => {
    await landFarChain();
    ingest(5, FAR_CHILD);
    await answer(lastSent(), false);
    const byRef = lastSent();
    expect(byRef.parentRef).toBe(byRef.parentKey); // the worker that rebuilt it holds it
    workers[0]!.answer({ delivery: 5, synthesisId: byRef.synthesisId, ok: false, error: STALE_PARENT, rgba: null, planes: null, width: 0, height: 0, elapsedMs: 1 });
    await tick();
    const rebuild = lastSent();
    expect(rebuild).toMatchObject({ delivery: 4, planesOnly: true });
    await answer(rebuild, false);
    const retry = lastSent();
    expect(retry.delivery).toBe(5);
    expect(retry.parentRef).toBeUndefined();
    expect(retry.parentPlanes).toHaveLength(THREE);
    await answer(retry, true);
    expect(sink.book.byDelivery.get(5)?.rgba).not.toBeNull();
    expect(sink.book.byDelivery.has(4)).toBe(true);
  });

  it('children hung on a brush that lands outside the cone are still redone on it', async () => {
    await landFarChain();
    ingest(5, FAR_CHILD);
    await answer(lastSent(), false);
    await answer(lastSent(), true);
    const before = workers[0]!.sent.length;
    ingest(6, FAR[3]!); // a retouch of the far brush: its child is redone on the new planes
    await answer(lastSent(), true);
    const redone = workers[0]!.sent.slice(before).filter((r) => r.delivery === 5);
    expect(redone).toHaveLength(1);
    expect(redone[0]!.parentPlanes ?? redone[0]!.parentRef).toBeDefined();
    expect(planesOf(6)).toBeNull();
  });
});
