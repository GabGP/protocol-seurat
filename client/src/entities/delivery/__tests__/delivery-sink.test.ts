import { describe, expect, it, vi } from 'vitest';
import { concat, viEncode } from '@/shared/proto/varint';
import { rangesEncode } from '@/shared/proto/ranges';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { fakeClient } from '../testing/fake-port';
import { makeSink } from '../testing/make-sink';

describe('DeliverySink', () => {
  it('atomically cleans up synthesis failures and releases the full subtree once', () => {
    const client = fakeClient();
    const postMessage = vi.fn();
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage, terminate: vi.fn() };
    vi.stubGlobal('Worker', class {
      get onmessage() { return worker.onmessage; }
      set onmessage(value: ((event: MessageEvent) => void) | null) { worker.onmessage = value; }
      postMessage = worker.postMessage;
      terminate = worker.terminate;
    });
    const sink = makeSink({ client });
    sink.ingest(makeDeliveryBytes({
      handle: 1, delivery: 10, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1,
    }), () => 1000, () => {}, 120);
    sink.book.byDelivery.set(20, {
      delivery: 20, brushId: makeBrushId(9, 0, 0), stratum: 9,
      from: 0, through: 1, bytes: 5, epoch: 1, edition: 1, expires: 121000, rgba: null,
    });
    sink.book.parentOf.set(20, 10);
    sink.book.childrenOf.set(10, new Set([20]));
    const req = postMessage.mock.calls[0]?.[0] as { delivery: number; synthesisId: number };
    const failure = { data: { delivery: req.delivery, synthesisId: req.synthesisId, ok: false, rgba: null, planes: null } } as MessageEvent;
    worker.onmessage?.(failure);
    worker.onmessage?.(failure);
    expect(sink.book.byDelivery.has(10)).toBe(false);
    expect(sink.book.byDelivery.has(20)).toBe(false);
    expect(sink.book.inFlight.has(10)).toBe(false);
    expect(client.sentRelease).toEqual([{ handle: 1, reason: 2, ranges: [10, 20] }]);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('deduplicates receipt when synthesis result is replayed after acknowledgement', async () => {
    const client = fakeClient();
    const postMessage = vi.fn();
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null, postMessage, terminate: vi.fn() };
    vi.stubGlobal('Worker', class {
      get onmessage() { return worker.onmessage; }
      set onmessage(value: ((event: MessageEvent) => void) | null) { worker.onmessage = value; }
      postMessage = worker.postMessage;
      terminate = worker.terminate;
    });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const sink = makeSink({ client });
    sink.ingest(makeDeliveryBytes({
      handle: 1, delivery: 11, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1,
    }), () => 1000, () => {}, 120);
    const req = postMessage.mock.calls[0]?.[0] as { delivery: number; synthesisId: number };
    const result = {
      data: { delivery: req.delivery, synthesisId: req.synthesisId, ok: true,
        rgba: new ArrayBuffer(4), planes: [], width: 1, height: 1, elapsedMs: 1 },
    } as MessageEvent;
    worker.onmessage?.(result);
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.book.pendingReceipt).toEqual([11]);
    sink.flushReceipt();
    worker.onmessage?.(result);
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.book.pendingReceipt).toEqual([]);
    expect(client.sentReceipt).toHaveLength(1);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('rejects delivery with mismatched CRC and sends SOLTAR reason=6', () => {
    const client = fakeClient();
    const sink = makeSink({ client });
    const bytes = makeDeliveryBytes({
      handle: 1,
      delivery: 10,
      brushId: makeBrushId(1, 0, 0),
      from: 0,
      through: 1,
      epoch: 1,
      corruptCrc: true,
    });
    sink.ingest(bytes, () => 1000, () => {}, 120);
    expect(sink.book.byDelivery.size).toBe(0);
    expect(client.sentRelease).toEqual([{ handle: 1, reason: 6, ranges: [10] }]);
    sink.dispose();
  });

  it('matchesScrape evaluates all 5 protocol predicates', () => {
    const client = fakeClient();
    const sink = makeSink({ client });

    const recE1 = {
      delivery: 5, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 2, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    };
    const recE8 = {
      delivery: 6, brushId: makeBrushId(8, 0, 0), stratum: 8,
      from: 0, through: 4, bytes: 2048, epoch: 1, edition: 1, expires: 5000, rgba: null,
    };

    // Predicate 5: ALL
    expect(sink.matchesScrape(recE1, 5, new Uint8Array(0))).toBe(true);

    // Predicate 1: ESTRATO_BAJO (drop if s < stratum)
    expect(sink.matchesScrape(recE1, 1, new Uint8Array([2]))).toBe(true);
    expect(sink.matchesScrape(recE1, 1, new Uint8Array([1]))).toBe(false);

    // Predicate 3: BANDAS (drop if stratum === e && upper > maxBands)
    expect(sink.matchesScrape(recE1, 3, new Uint8Array([1, 1]))).toBe(true);
    expect(sink.matchesScrape(recE1, 3, new Uint8Array([1, 3]))).toBe(false);
    expect(sink.matchesScrape(recE8, 3, new Uint8Array([1, 1]))).toBe(false);

    // Predicate 4: LISTA
    const listParams = rangesEncode([5, 10]);
    expect(sink.matchesScrape(recE1, 4, listParams)).toBe(true);
    expect(sink.matchesScrape(recE8, 4, listParams)).toBe(false);

    // Predicate 2: FUERA (rect intersection for s < 7)
    // recE1 is at s=1, bx=0, by=0 -> rect is [0, 0, 512, 512]
    const outsideRect = concat(viEncode(1000), viEncode(1000), viEncode(2000), viEncode(2000));
    const insideRect = concat(viEncode(100), viEncode(100), viEncode(400), viEncode(400));
    expect(sink.matchesScrape(recE1, 2, outsideRect)).toBe(true); // outside, so drop
    expect(sink.matchesScrape(recE1, 2, insideRect)).toBe(false); // intersects, so keep
    expect(sink.matchesScrape(recE8, 2, outsideRect)).toBe(false); // s=8 >= 7, never dropped by FUERA

    sink.dispose();
  });

  it('applyScrape removes matching records and sends exact RASPADO', () => {
    const client = fakeClient();
    const sink = makeSink({ client });

    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(0, 0, 0), stratum: 0,
      from: 0, through: 1, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });
    sink.book.byDelivery.set(2, {
      delivery: 2, brushId: makeBrushId(2, 0, 0), stratum: 2,
      from: 0, through: 1, bytes: 2048, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });
    sink.book.byDelivery.set(3, {
      delivery: 3, brushId: makeBrushId(0, 1, 0), stratum: 0,
      from: 0, through: 1, bytes: 1024, epoch: 1, edition: 1, expires: 5000, rgba: null,
    });

    // Scrape stratum < 1 up to delivery 2
    sink.applyScrape({
      handle: 1, order: 5, epoch: 2, through: 2, predicate: 1, params: new Uint8Array([1]),
    }, () => 1000);

    expect(client.sentScraped.length).toBe(1);
    const r = client.sentScraped[0];
    expect(r?.order).toBe(5);
    expect(r?.through).toBe(2);
    expect(r?.scrapedCount).toBe(1); // delivery 1 was scraped
    expect(r?.kept).toEqual([2]); // delivery 2 was kept
    expect(sink.book.byDelivery.has(1)).toBe(false);
    expect(sink.book.byDelivery.has(2)).toBe(true);
    expect(sink.book.byDelivery.has(3)).toBe(true); // delivery 3 > through 2, untouched

    sink.dispose();
  });

  it('applyRenew extends lease and inventory reports accurately', () => {
    const client = fakeClient();
    const sink = makeSink({ client });

    sink.book.byDelivery.set(10, {
      delivery: 10, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 1, bytes: 1500, epoch: 1, edition: 1, expires: 2000, rgba: null,
    });

    sink.applyRenew([10], 4, 120, () => 1000);
    expect(sink.book.byDelivery.get(10)?.expires).toBe(1000 + 120000);
    expect(sink.renewThrough).toBe(4);
    expect(client.sentReceipt.length).toBe(1);
    expect(client.sentReceipt[0]?.renewThrough).toBe(4);

    const inv = sink.inventory(20);
    expect(inv.brushCount).toBe(1);
    expect(inv.kib).toBe(2);
    expect(inv.ranges).toEqual([10]);

    sink.dispose();
  });

  it('sweepExpiry purges expired records and sends batched SOLTAR reason=3', () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sink = makeSink({ client });

    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 1, bytes: 500, epoch: 1, edition: 1, expires: 500, rgba: null,
    });

    sink.sweepExpiry(() => 1000); // 1000 > expires 500
    expect(sink.book.byDelivery.has(1)).toBe(false);

    vi.advanceTimersByTime(100);
    expect(client.sentRelease).toEqual([{ handle: 1, reason: 3, ranges: [1] }]);

    sink.dispose();
    vi.useRealTimers();
  });

  it('sweepExpiry releases an expired subtree without duplicate delivery numbers', () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sink = makeSink({ client });
    sink.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(2, 0, 0), stratum: 2,
      from: 0, through: 1, bytes: 500, epoch: 1, edition: 1, expires: 500, rgba: null,
    });
    sink.book.byDelivery.set(2, {
      delivery: 2, brushId: makeBrushId(1, 0, 0), stratum: 1,
      from: 0, through: 1, bytes: 500, epoch: 1, edition: 1, expires: 500, rgba: null,
    });
    sink.book.parentOf.set(2, 1);
    sink.book.childrenOf.set(1, new Set([2]));

    sink.sweepExpiry(() => 1000);
    vi.advanceTimersByTime(100);

    expect(client.sentRelease).toEqual([{ handle: 1, reason: 3, ranges: [1, 2] }]);
    sink.dispose();
    vi.useRealTimers();
  });

  it('measures RTT through setView and planned, expanding the free credit window', () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sink = makeSink({ client });
    const s = (sink as unknown as { s: { linkBps: number; avgDelivery: number } }).s;
    s.linkBps = 50_000;
    s.avgDelivery = 46_000;
    expect(sink.free()).toBe(2);

    sink.setView(0, 0, 100, 100, 100, 100, 1);
    vi.advanceTimersByTime(2000);
    sink.planned(1);
    expect(sink.free()).toBe(4);

    sink.dispose();
    vi.useRealTimers();
  });
});
