import { describe, expect, it } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import { refuse } from '../sink/refusal';
import { SinkState } from '../sink/state';
import { heldBrushes, inventoryOf, type DeliveryRecord } from '../store';
import { fakeClient } from '../testing/fake-port';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';
import type { DeliverySink } from '../sink/delivery-sink';
import type { SynthWorker } from '../worker-pool';

/** The spec counts the book in brushes (§4.1 c, §5.4): a brush that arrived as [0,2) then [2,4) is one. */
const rec = (delivery: number, bx: number, from: number, edition = 1): DeliveryRecord => ({
  delivery, brushId: makeBrushId(0, bx, 0), stratum: 0, from, through: from + 2, bytes: 10, epoch: 1, edition, expires: 1e12, rgba: null,
});

/** `n` brushes, each held as two deliveries: [0,2) numbered 2i+1 and [2,4) numbered 2i+2. */
function holdTwice(sink: DeliverySink, n: number): void {
  for (let i = 0; i < n; i++) {
    sink.book.byDelivery.set(2 * i + 1, rec(2 * i + 1, i, 0));
    sink.book.byDelivery.set(2 * i + 2, rec(2 * i + 2, i, 2));
  }
}

const state = (max: number): SinkState => new SinkState(1, () => null, { maxKiB: () => 1e6, maxBrushes: () => max }, 192, 160, 11, 1,
  () => new FakeWorker() as unknown as SynthWorker);

describe('the book counts brushes, not deliveries', () => {
  it('heldBrushes counts brush+edition once however many deliveries it took', () => {
    const s = state(768);
    holdTwice(s as unknown as DeliverySink, 3);
    expect(s.book.byDelivery.size).toBe(6);
    expect(heldBrushes(s.book)).toBe(3);
    s.book.byDelivery.set(7, rec(7, 0, 0, 2)); // the same brush of edition 2 is another held brush
    expect(heldBrushes(s.book)).toBe(4);
    expect(inventoryOf(s.book, 7).brushCount).toBe(4);
  });

  it('N brushes as 2N deliveries at a cap of N + 9 are under no pressure: nothing is evicted', () => {
    const client = fakeClient();
    const n = 25;
    const sink = makeSink({ client, maxBrushes: n + 9 });
    sink.setExtent(16384, 16384);
    holdTwice(sink, n);
    sink.setView(0, 0, 512, 512, 512, 512);
    expect(sink.eviction.evicted).toBe(0);
    expect(client.sentRelease).toEqual([]);
    expect(sink.book.byDelivery.size).toBe(2 * n);
    sink.dispose();
  });

  it('RECIBO.libre is the cap less the brushes held, not less the deliveries', () => {
    const sink = makeSink({ maxBrushes: 40 });
    holdTwice(sink, 30);
    expect(sink.free()).toBeGreaterThan(0); // 60 deliveries would have closed it
    expect(sink.free()).toBeLessThanOrEqual(10);
    holdTwice(sink, 40);
    expect(sink.free()).toBe(0);
    sink.dispose();
  });

  it('a full book still accepts an upgrade of a held brush and refuses a new one', () => {
    const s = state(3);
    // Sketch brushes are never evicted, so the full book cannot make room by itself.
    const sketch = (delivery: number, bx: number, from: number, edition = 1): DeliveryRecord =>
      ({ ...rec(delivery, bx, from, edition), brushId: makeBrushId(8, bx, 0), stratum: 8 });
    for (let bx = 1; bx <= 3; bx++) s.book.byDelivery.set(bx, sketch(bx, bx, 0));
    expect(refuse(s, sketch(10, 2, 2), 10)).toBeNull(); // [2,4) of a brush already held
    expect(refuse(s, sketch(11, 9, 0), 10)?.[0]).toBe('capacity');
    expect(refuse(s, sketch(12, 2, 2, 2), 10)?.[0]).toBe('capacity'); // another edition is a new brush
  });
});
