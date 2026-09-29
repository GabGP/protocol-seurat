import { describe, expect, it } from 'vitest';
import { DeliverySink } from '../sink/delivery-sink';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { makeBrushId } from '@/shared/proto/brush';
import type { DeliveryPort } from '../sink/port';
import type { SynthWorker } from '../worker-pool';

/** Spec 4.2.4 (RASPADO after every number ≤ N is settled) and 5.4 (checks on arrival). */

function fakeClient() {
  const released: Array<{ reason: number; ranges: number[] }> = [];
  const scraped: Array<{ order: number; through: number; count: number; kept: number[] }> = [];
  const c = {
    released,
    scraped,
    sendRelease(_h: number, reason: number, ranges: number[]) {
      released.push({ reason, ranges });
    },
    sendScraped(_h: number, order: number, _e: number, through: number, count: number, _k: number, kept: number[]) {
      scraped.push({ order, through, count, kept });
    },
    sendReceipt() {},
    sendInventory() {},
  };
  return c as unknown as DeliveryPort & typeof c;
}

const idleWorker = (): SynthWorker => ({ onmessage: null, postMessage() {}, terminate() {} }) as unknown as SynthWorker;

function delivery(n: number, stratum: number, epoch = 1, bx = 0): Uint8Array {
  const band = new Uint8Array([1, 2, 3]);
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, makeBrushId(stratum, bx, 0));
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32c(band));
  return concat(viEncode(1), viEncode(1), viEncode(n), id, new Uint8Array([0x01]), viEncode(epoch),
    new Uint8Array([4, 6]), viEncode(1), crc, viEncode(band.length), band);
}

function sink(client: ReturnType<typeof fakeClient>): DeliverySink {
  return new DeliverySink(1, () => client, () => 36864, () => 768, 192, 160, 11, 1, idleWorker);
}

const ingest = (s: DeliverySink, bytes: Uint8Array): void => s.ingest(bytes, () => 1000, () => {}, 120);
const lowStratum = (stratum: number) => ({ handle: 1, order: 3, epoch: 2, through: 3, predicate: 1, params: new Uint8Array([stratum]) });

describe('RASPADO waits for settlement', () => {
  it('drops a late ≤ N delivery the predicate covers, and answers once every number ≤ N settled', () => {
    const client = fakeClient();
    const s = sink(client);
    ingest(s, delivery(1, 10));
    s.applyScrape(lowStratum(8), () => 1000);
    expect(client.scraped).toEqual([]); // 2 and 3 are still on the wire
    ingest(s, delivery(2, 7));
    expect(s.book.byDelivery.has(2)).toBe(false); // 4.2.4b: dropped on arrival
    expect(client.scraped).toEqual([]);
    s.applyPlanCanceladas([3]);
    expect(client.scraped).toEqual([{ order: 3, through: 3, count: 1, kept: [1] }]);
    s.dispose();
  });

  it('after a resume, numbers the old connection never delivered are settled', () => {
    const client = fakeClient();
    const s = sink(client);
    ingest(s, delivery(1, 10));
    s.resumed();
    s.applyScrape({ ...lowStratum(8), through: 9 }, () => 1000);
    expect(client.scraped.length).toBe(1);
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
    expect(client.released).toContainEqual({ reason: 4, ranges: [2] });
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
