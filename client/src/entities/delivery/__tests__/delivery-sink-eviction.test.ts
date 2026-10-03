import { describe, expect, it, vi } from 'vitest';
import { linkParent } from '../sink/brush-graph';
import { makeBrushId, brushKey } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { planesKey } from '@/workers/protocol';
import { fakeClient } from '../testing/fake-port';
import { makeSink } from '../testing/make-sink';

describe('DeliverySink eviction, decode and revisions', () => {
  it('tells the server when a busy decode queue drains, so plans resume without waiting for a renewal', () => {
    const client = fakeClient();
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null };
    vi.stubGlobal('Worker', class {
      get onmessage() { return worker.onmessage; }
      set onmessage(value: ((event: MessageEvent) => void) | null) { worker.onmessage = value; }
      postMessage = vi.fn();
      terminate = vi.fn();
    });
    const sink = makeSink({ client, poolSize: 1 });
    for (let n = 1; n <= 40; n++) { // 40 syntheses in the worker ≈ 200 ms of backlog
      sink.ingest(makeDeliveryBytes({ handle: 1, delivery: n, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    }
    sink.applyRenew([], 1, 120, () => 1000);
    expect(client.sentReceipt.at(-1)?.queueMs).toBeGreaterThanOrEqual(150);
    for (let n = 0; n < 40; n++) {
      worker.onmessage?.({ data: { delivery: 999, synthesisId: -1, ok: false, rgba: null, planes: null, elapsedMs: 5 } } as MessageEvent);
    }
    expect(client.sentReceipt).toHaveLength(3);
    expect(client.sentReceipt.at(-1)?.queueMs).toBeLessThan(150);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('re-linking a child to a new parent leaves no stale link on the old one', () => {
    const sink = makeSink();
    linkParent(sink.book, 5, 1);
    linkParent(sink.book, 5, 2);
    expect(sink.book.childrenOf.get(1)?.has(5)).toBe(false);
    expect(sink.book.childrenOf.get(2)?.has(5)).toBe(true);
    sink.dispose();
  });

  it('moving away evicts the farthest brushes (SOLTAR 1) and a RECIBO reopens the window', () => {
    const client = fakeClient();
    const sink = makeSink({ client, maxBrushes: 40 });
    for (let bx = 0; bx < 36; bx++) { // a row of level-0 brushes; delivery n = bx + 1
      sink.book.byDelivery.set(bx + 1, {
        delivery: bx + 1, brushId: makeBrushId(0, bx, 0), stratum: 0,
        from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    }
    sink.setView(0, 0, 512, 512, 512, 512); // on screen: bx 0 and 1

    expect(client.sentRelease).toEqual([{ handle: 1, reason: 1, ranges: [31, 32, 33, 34, 35, 36] }]);
    expect(sink.book.byDelivery.has(1) && sink.book.byDelivery.has(2)).toBe(true);
    expect(client.sentReceipt.at(-1)?.free).toBe(8); // min(40 max - 30 held, CREDIT_UNMEASURED)
    expect(sink.eviction).toMatchObject({ evicted: 6, evictedBytes: 60, refetched: 0 });
    sink.ingest(makeDeliveryBytes({ handle: 1, delivery: 99, brushId: makeBrushId(0, 35, 0), from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    expect(sink.eviction.refetched).toBe(1); // the evicted brush came back: the eviction cost a resend
    expect(sink.eviction.refetchedBytes).toBeGreaterThan(0);
    sink.dispose();
  });

  it('a failed VRAM reservation evicts a quarter of what is held (SOLTAR 1) even without count pressure', () => {
    const client = fakeClient();
    const sink = makeSink({ client });
    for (let bx = 0; bx < 36; bx++) {
      sink.book.byDelivery.set(bx + 1, {
        delivery: bx + 1, brushId: makeBrushId(0, bx, 0), stratum: 0,
        from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    }
    sink.setView(0, 0, 512, 512, 512, 512);
    expect(client.sentRelease).toEqual([]); // 36 of 768: no pressure
    sink.reportVramFailure();
    expect(client.sentRelease).toEqual([{ handle: 1, reason: 1, ranges: [28, 29, 30, 31, 32, 33, 34, 35, 36] }]);
    expect(sink.book.byDelivery.size).toBe(27);
    expect(sink.book.byDelivery.has(1) && sink.book.byDelivery.has(2)).toBe(true);
    sink.dispose();
  });

  it('a retouch decodes the bands its brush already holds, and children are redone on it', async () => {
    const client = fakeClient();
    const postMessage = vi.fn();
    const made: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = [];
    vi.stubGlobal('Worker', class {
      onmessage: ((event: MessageEvent) => void) | null = null;
      postMessage = postMessage;
      terminate = vi.fn();
      constructor() {
        made.push(this);
      }
    });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const sink = makeSink({ client });
    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(10, 0, 0), stratum: 10,
      from: 0, through: 4, bytes: 5, epoch: 1, edition: 1, expires: 121000, rgba: null, planes: [new ArrayBuffer(2)],
    });
    const brush = makeBrushId(9, 0, 0);
    sink.ingest(makeDeliveryBytes({ handle: 1, delivery: 2, brushId: brush, from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    sink.book.byDelivery.set(4, {
      delivery: 4, brushId: makeBrushId(8, 0, 0), stratum: 8,
      from: 0, through: 1, bytes: 5, epoch: 1, edition: 1, expires: 121000, rgba: null, bands: [new ArrayBuffer(1)],
    });
    sink.book.childrenOf.set(2, new Set([4]));
    sink.ingest(makeDeliveryBytes({ handle: 1, delivery: 3, brushId: brush, from: 1, through: 2, epoch: 1 }), () => 1000, () => {}, 120);

    const retouch = postMessage.mock.calls[1]?.[0] as { delivery: number; synthesisId: number; bands: ArrayBuffer[] };
    expect(retouch.delivery).toBe(3);
    expect(retouch.bands).toHaveLength(2); // [0,1) from delivery 2 + its own [1,2)

    made[1]?.onmessage?.({ data: { delivery: 3, synthesisId: retouch.synthesisId, ok: true,
      rgba: new ArrayBuffer(4), planes: [new ArrayBuffer(6)], width: 1, height: 1, elapsedMs: 1 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    const redo = postMessage.mock.calls[2]?.[0] as { delivery: number; parentRef?: string; parentPlanes?: ArrayBuffer[] };
    expect(redo.delivery).toBe(4); // hung on the sketch (2), rebuilt on the retouch's planes
    expect(redo.parentRef).toBe(planesKey(brushKey(brush, 1), retouch.synthesisId)); // by reference: made[1] just made them
    expect(redo.parentPlanes).toBeUndefined();
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('assigns a distinct book revision per sink and bumps it on every mutation', () => {
    const a = makeSink();
    const b = makeSink();
    expect(a.revision).not.toBe(b.revision);
    a.book.byDelivery.set(10, {
      delivery: 10, brushId: makeBrushId(10, 0, 0), stratum: 10,
      from: 0, through: 1, bytes: 5, epoch: 1, edition: 1, expires: 121000, rgba: null,
    });
    const r0 = a.revision;
    a.applyPlanCanceladas([10]);
    expect(a.book.byDelivery.has(10)).toBe(false);
    expect(a.revision).not.toBe(r0);
    const r1 = a.revision;
    a.dispose();
    b.dispose();
    expect(a.revision).not.toBe(r1);
  });

  it('bumps book revision on ingest', () => {
    vi.stubGlobal('Worker', class {
      postMessage = vi.fn();
      terminate = vi.fn();
      set onmessage(_value: unknown) { /* dispatched only */ }
    });
    const sink = makeSink();
    const r0 = sink.revision;
    sink.ingest(makeDeliveryBytes({
      handle: 1, delivery: 10, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1,
    }), () => 1000, () => {}, 120);
    expect(sink.book.byDelivery.has(10)).toBe(true);
    expect(sink.revision).not.toBe(r0);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('checkExpiry before a paint drops a lease the moment it ends, and a renewal defers it (spec 5.2.2)', () => {
    vi.stubGlobal('Worker', class {
      postMessage = vi.fn();
      terminate = vi.fn();
      set onmessage(_value: unknown) { /* dispatched only */ }
    });
    const sink = makeSink();
    sink.ingest(makeDeliveryBytes({
      handle: 1, delivery: 10, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1,
    }), () => 1000, () => {}, 120); // vence = 121 000
    sink.checkExpiry(120_999);
    expect(sink.book.byDelivery.has(10)).toBe(true);
    sink.applyRenew([10], 1, 120, () => 60_000); // vence = 180 000
    sink.checkExpiry(121_000);
    expect(sink.book.byDelivery.has(10)).toBe(true);
    const r = sink.revision;
    sink.checkExpiry(180_000);
    expect(sink.book.byDelivery.has(10)).toBe(false);
    expect(sink.revision).not.toBe(r); // the frame that checked repaints without it
    sink.dispose();
    vi.unstubAllGlobals();
  });
});
