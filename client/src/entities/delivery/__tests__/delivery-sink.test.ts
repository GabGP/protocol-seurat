import { describe, expect, it, vi } from 'vitest';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { rangesEncode } from '@/shared/proto/ranges';
import { makeBrushId } from '@/shared/proto/brush';
import type { SessionClient } from '@/app/providers/session-client';

function fakeClient() {
  const sentRelease: Array<{ handle: number; reason: number; ranges: number[] }> = [];
  const sentScraped: Array<{ handle: number; order: number; epoch: number; through: number; scrapedCount: number; freedKib: number; kept: number[] }> = [];
  const sentReceipt: Array<{ handle: number; completed: number[]; queueMs: number; free: number; renewThrough: number }> = [];
  const sentInventory: Array<{ handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[] }> = [];

  const c = {
    sentRelease,
    sentScraped,
    sentReceipt,
    sentInventory,
    sendRelease(handle: number, reason: number, ranges: number[]) {
      sentRelease.push({ handle, reason, ranges });
    },
    sendScraped(handle: number, order: number, epoch: number, through: number, scrapedCount: number, freedKib: number, kept: number[]) {
      sentScraped.push({ handle, order, epoch, through, scrapedCount, freedKib, kept });
    },
    sendReceipt(handle: number, completed: number[], queueMs: number, free: number, renewThrough: number) {
      sentReceipt.push({ handle, completed, queueMs, free, renewThrough });
    },
    sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]) {
      sentInventory.push({ handle, order, through, brushCount, kib, ranges });
    },
  };
  return c as unknown as SessionClient & typeof c;
}

function makeDeliveryBytes(opts: {
  handle: number;
  delivery: number;
  brushId: bigint;
  from: number;
  through: number;
  epoch: number;
  qY?: number;
  qC?: number;
  corruptCrc?: boolean;
}): Uint8Array {
  const band = new Uint8Array([10, 20, 30, 40, 50]);
  const bandCrc = crc32c(band);
  const crcVal = opts.corruptCrc ? bandCrc ^ 0xff : bandCrc;

  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, opts.brushId);

  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crcVal);

  const head = concat(
    viEncode(0x01),
    viEncode(opts.handle),
    viEncode(opts.delivery),
    bIdBuf,
    new Uint8Array([((opts.from & 0xf) << 4) | (opts.through & 0xf)]),
    viEncode(opts.epoch),
    new Uint8Array([opts.qY ?? 4, opts.qC ?? 6]),
    viEncode(1), // edition
    crcBuf,
    viEncode(band.length),
  );
  return concat(head, band);
}

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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
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
    (sink as unknown as { flushReceipt: () => void }).flushReceipt();
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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);

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
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
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

  it('tells the server when a busy decode queue drains, so plans resume without waiting for a renewal', () => {
    const client = fakeClient();
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null };
    vi.stubGlobal('Worker', class {
      get onmessage() { return worker.onmessage; }
      set onmessage(value: ((event: MessageEvent) => void) | null) { worker.onmessage = value; }
      postMessage = vi.fn();
      terminate = vi.fn();
    });
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
    for (let n = 1; n <= 40; n++) { // 40 syntheses in the worker ≈ 200 ms of backlog
      sink.ingest(makeDeliveryBytes({ handle: 1, delivery: n, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1 }), () => 1000, () => {}, 120);
    }
    sink.applyRenew([], 1, 120, () => 1000);
    expect(client.sentReceipt.at(-1)?.queueMs).toBeGreaterThanOrEqual(150);
    for (let n = 0; n < 40; n++) {
      worker.onmessage?.({ data: { delivery: 999, synthesisId: -1, ok: false, rgba: null, planes: null, elapsedMs: 5 } } as MessageEvent);
    }
    expect(client.sentReceipt).toHaveLength(2);
    expect(client.sentReceipt.at(-1)?.queueMs).toBeLessThan(150);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('re-linking a child to a new parent leaves no stale link on the old one', () => {
    const sink = new DeliverySink(1, () => fakeClient(), () => 36864, () => 768);
    const link = (sink as unknown as { linkParent: (c: number, p: number) => void }).linkParent.bind(sink);
    link(5, 1);
    link(5, 2);
    expect(sink.book.childrenOf.get(1)?.has(5)).toBe(false);
    expect(sink.book.childrenOf.get(2)?.has(5)).toBe(true);
    sink.dispose();
  });

  it('moving away evicts the farthest brushes (SOLTAR 1) and a RECIBO reopens the window', () => {
    const client = fakeClient();
    const sink = new DeliverySink(1, () => client, () => 36864, () => 40);
    for (let bx = 0; bx < 36; bx++) { // a row of level-0 brushes; delivery n = bx + 1
      sink.book.byDelivery.set(bx + 1, {
        delivery: bx + 1, brushId: makeBrushId(0, bx, 0), stratum: 0,
        from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    }
    sink.setView(0, 0, 512, 512, 512, 512); // on screen: bx 0 and 1

    expect(client.sentRelease).toEqual([{ handle: 1, reason: 1, ranges: [31, 32, 33, 34, 35, 36] }]);
    expect(sink.book.byDelivery.has(1) && sink.book.byDelivery.has(2)).toBe(true);
    expect(client.sentReceipt.at(-1)?.free).toBe(10); // 40 max - 30 held
    sink.dispose();
  });

  it('a retouch decodes the bands its brush already holds, and children are redone on it', async () => {
    const client = fakeClient();
    const postMessage = vi.fn();
    const worker = { onmessage: null as ((event: MessageEvent) => void) | null };
    vi.stubGlobal('Worker', class {
      get onmessage() { return worker.onmessage; }
      set onmessage(value: ((event: MessageEvent) => void) | null) { worker.onmessage = value; }
      postMessage = postMessage;
      terminate = vi.fn();
    });
    vi.stubGlobal('ImageData', class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    const sink = new DeliverySink(1, () => client, () => 36864, () => 768);
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

    worker.onmessage?.({ data: { delivery: 3, synthesisId: retouch.synthesisId, ok: true,
      rgba: new ArrayBuffer(4), planes: [new ArrayBuffer(6)], width: 1, height: 1, elapsedMs: 1 } } as MessageEvent);
    await Promise.resolve();
    await Promise.resolve();
    const redo = postMessage.mock.calls[2]?.[0] as { delivery: number; parentPlanes: ArrayBuffer[] };
    expect(redo.delivery).toBe(4); // hung on the sketch (2), rebuilt on the retouch's planes
    expect(redo.parentPlanes[0]?.byteLength).toBe(6);
    sink.dispose();
    vi.unstubAllGlobals();
  });

  it('assigns a distinct book revision per sink and bumps it on every mutation', () => {
    const a = new DeliverySink(1, () => fakeClient(), () => 36864, () => 768);
    const b = new DeliverySink(1, () => fakeClient(), () => 36864, () => 768);
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
    const sink = new DeliverySink(1, () => fakeClient(), () => 36864, () => 768);
    const r0 = sink.revision;
    sink.ingest(makeDeliveryBytes({
      handle: 1, delivery: 10, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1,
    }), () => 1000, () => {}, 120);
    expect(sink.book.byDelivery.has(10)).toBe(true);
    expect(sink.revision).not.toBe(r0);
    sink.dispose();
    vi.unstubAllGlobals();
  });
});
