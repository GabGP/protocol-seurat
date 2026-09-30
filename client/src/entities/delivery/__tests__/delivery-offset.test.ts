import { describe, expect, it } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { concat } from '@/shared/proto/varint';
import type { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';

const BAND = new Uint8Array([11, 22, 33, 44, 55, 66]);

describe('DeliverySink ingest from a view at a non-zero byteOffset', () => {
  it('keeps and transfers only the band bytes, never the whole WS message', () => {
    const workers: FakeWorker[] = [];
    const sink = makeSink({ poolSize: 1, workers });
    const body = makeDeliveryBytes({ handle: 1, delivery: 7, brushId: makeBrushId(10, 0, 0), from: 0, through: 1, epoch: 1, band: BAND });
    const message = concat([1], body); // the WS channel byte ahead of the delivery, as ws.ts receives it
    const view = message.subarray(1);
    expect(view.byteOffset).toBe(1);
    sink.ingest(view, () => 1000, () => {}, 120);
    const rec = sink.book.byDelivery.get(7);
    expect(rec?.bands?.map((b) => Array.from(new Uint8Array(b)))).toEqual([Array.from(BAND)]);
    const sent = workers[0]?.sent[0]?.bands ?? [];
    expect(sent.map((b) => Array.from(new Uint8Array(b)))).toEqual([Array.from(BAND)]);
    expect(Array.from(message.subarray(1))).toEqual(Array.from(body)); // the message itself is left intact
    sink.dispose();
  });
});
