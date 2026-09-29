import { describe, expect, it } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import { HandleLedgers } from '../ledgers';
import type { DeliveryRecord } from '../store';
import { freeSuperseded, restoreNewest } from '../sink/superseded';
import { SinkState } from '../sink/state';
import type { SynthWorker } from '../worker-pool';
import { FakeWorker } from '../testing/fake-worker';

const bmp = (): { closed: boolean; close(): void } => {
  const b = { closed: false, close() { b.closed = true; } };
  return b;
};

function rec(delivery: number, over: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    delivery, brushId: makeBrushId(2, 1, 1), stratum: 2, from: 0, through: 1, bytes: 10, epoch: 1, edition: 1,
    expires: 0, rgba: bmp() as unknown as ImageBitmap, bands: [new ArrayBuffer(8)], planes: [new ArrayBuffer(8)], ...over,
  };
}

function stateWith(...recs: DeliveryRecord[]): SinkState {
  const s = new SinkState(1, () => null, { maxKiB: () => 1, maxBrushes: () => 1 }, 192, 160, 11, 1, () => new FakeWorker() as unknown as SynthWorker);
  for (const r of recs) s.book.byDelivery.set(r.delivery, r);
  return s;
}

describe('superseded brush records', () => {
  it('free the bitmap and planes of older same-brush deliveries but keep their bands', () => {
    const older = rec(1);
    const newer = rec(2);
    const olderBmp = older.rgba as unknown as { closed: boolean };
    freeSuperseded(stateWith(older, newer), newer);
    expect(older.rgba).toBeNull();
    expect(olderBmp.closed).toBe(true);
    expect(older.planes).toBeNull();
    expect(older.bands).toHaveLength(1);
    expect(newer.rgba).not.toBeNull();
    expect(newer.planes).not.toBeNull();
  });

  it('leave other brushes alone', () => {
    const other = rec(1, { brushId: makeBrushId(2, 0, 0) });
    const newer = rec(2);
    freeSuperseded(stateWith(other, newer), newer);
    expect(other.rgba).not.toBeNull();
  });

  it('resynthesize the newest survivor from its bands when the newest one is gone', () => {
    const older = rec(1, { rgba: null, planes: null });
    const gone = rec(2);
    const s = stateWith(older);
    restoreNewest(s, [gone]);
    expect(older.pending).toBe(true);
    expect(s.pending.has(1)).toBe(true); // parked for its parent's planes: resynthesis started
  });

  it('do nothing while a sibling still shows the brush', () => {
    const shown = rec(1);
    const s = stateWith(shown);
    restoreNewest(s, [rec(2)]);
    expect(shown.pending).toBeUndefined();
  });
});

describe('retired ledgers', () => {
  it('keep only the numbers: no bitmap, bands or planes', () => {
    const ledgers = new HandleLedgers(4);
    const held = rec(5, { brushId: makeBrushId(2, 0, 0) });
    ledgers.record(7, held);
    const book = { ...stateWith(rec(6)).book };
    ledgers.adopt(7, book);
    expect(ledgers.inventory(7, 100).brushCount).toBe(2);
    const view = (ledgers as unknown as { books: Map<number, { byDelivery: Map<number, DeliveryRecord> }> }).books.get(7);
    for (const r of view?.byDelivery.values() ?? []) {
      expect(r.rgba).toBeNull();
      expect(r.bands).toEqual([]);
      expect(r.planes).toBeNull();
    }
  });
});
