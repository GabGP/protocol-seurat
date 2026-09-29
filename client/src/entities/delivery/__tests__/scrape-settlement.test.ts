import { describe, expect, it } from 'vitest';
import { DeliverySink } from '../sink/delivery-sink';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { fakeClient } from '../testing/fake-port';
import { makeSink } from '../testing/make-sink';

/** Spec 4.2.4 (RASPADO after every number ≤ N is settled) and 5.4 (checks on arrival). */

const delivery = (n: number, stratum: number, epoch = 1, bx = 0): Uint8Array =>
  makeDeliveryBytes({ handle: 1, delivery: n, brushId: makeBrushId(stratum, bx, 0), from: 0, through: 1, epoch, band: new Uint8Array([1, 2, 3]) });

const sink = (client: ReturnType<typeof fakeClient>): DeliverySink => makeSink({ client, poolSize: 1, workers: [] });

const ingest = (s: DeliverySink, bytes: Uint8Array): void => s.ingest(bytes, () => 1000, () => {}, 120);
const lowStratum = (stratum: number) => ({ handle: 1, order: 3, epoch: 2, through: 3, predicate: 1, params: new Uint8Array([stratum]) });

describe('RASPADO waits for settlement', () => {
  it('drops a late ≤ N delivery the predicate covers, and answers once every number ≤ N settled', () => {
    const client = fakeClient();
    const s = sink(client);
    ingest(s, delivery(1, 10));
    s.applyScrape(lowStratum(8), () => 1000);
    expect(client.sentScraped).toEqual([]); // 2 and 3 are still on the wire
    ingest(s, delivery(2, 7));
    expect(s.book.byDelivery.has(2)).toBe(false); // 4.2.4b: dropped on arrival
    expect(client.sentScraped).toEqual([]);
    s.applyPlanCanceladas([3]);
    expect(client.sentScraped).toMatchObject([{ order: 3, through: 3, scrapedCount: 1, kept: [1] }]);
    s.dispose();
  });

  it('after a resume, numbers the old connection never delivered are settled', () => {
    const client = fakeClient();
    const s = sink(client);
    ingest(s, delivery(1, 10));
    s.resumed();
    s.applyScrape({ ...lowStratum(8), through: 9 }, () => 1000);
    expect(client.sentScraped.length).toBe(1);
    s.dispose();
  });
});

describe('checks on arrival (spec 5.4)', () => {
  it('holds a delivery of an epoch whose CONCESION has not arrived, then applies it', () => {
    const client = fakeClient();
    const s = sink(client);
    s.concede({ epoch: 1, minStratum: 7, maxBands: 4 });
    ingest(s, delivery(1, 10, 2));
    expect(s.book.byDelivery.has(1)).toBe(false);
    s.concede({ epoch: 2, minStratum: 7, maxBands: 4 });
    expect(s.book.byDelivery.has(1)).toBe(true);
    s.dispose();
  });

  it('drops and releases what the concession does not allow', () => {
    const client = fakeClient();
    const s = sink(client);
    s.concede({ epoch: 1, minStratum: 7, maxBands: 4 });
    ingest(s, delivery(1, 10));
    ingest(s, delivery(2, 1));
    expect(s.book.byDelivery.has(2)).toBe(false);
    expect(client.sentRelease).toContainEqual({ handle: 1, reason: 4, ranges: [2] });
    s.dispose();
  });

  it('drops an orphan whose parent is neither held nor on its way', () => {
    const client = fakeClient();
    const s = sink(client);
    s.concede({ epoch: 1, minStratum: 0, maxBands: 4 });
    ingest(s, delivery(1, 10));
    ingest(s, delivery(2, 8));
    expect(s.book.byDelivery.has(2)).toBe(false);
    ingest(s, delivery(4, 8, 1, 2));
    expect(s.book.byDelivery.has(4)).toBe(true); // 3 may be its parent E9(1,0), still in flight: wait
    s.dispose();
  });
});
