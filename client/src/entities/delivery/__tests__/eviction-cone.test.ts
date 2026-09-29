import { describe, expect, it } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import { coreMissing, focusBands } from '../sink/core-deficit';
import { SinkState } from '../sink/state';
import { fakeClient } from '../testing/fake-port';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';
import type { DeliverySink } from '../sink/delivery-sink';
import type { SynthWorker } from '../worker-pool';

/** View [0,512]² at 512 px: focus 0, core = 4 tiles at stratum 0 + one per stratum 1..9. */
const CORE: Array<[number, number, number]> = [
  [0, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1],
  ...Array.from({ length: 9 }, (_, i) => [i + 1, 0, 0] as [number, number, number]),
];
/** Ring 1 (stratum 1 over F_1) and ring 2 (stratum 2 over F_2), less the core: in the cone, not on screen. */
const RINGS: Array<[number, number, number]> = [[1, 1, 0], [1, 0, 1], [1, 1, 1], [2, 1, 0], [2, 0, 1], [2, 1, 1]];
/** Far away at stratum 0: outside the current cone. */
const FAR: Array<[number, number, number]> = Array.from({ length: 6 }, (_, i) => [0, 40 + i, 40] as [number, number, number]);

function hold(sink: DeliverySink, brushes: Array<[number, number, number]>, through = 4): void {
  brushes.forEach(([stratum, bx, by], i) => sink.book.byDelivery.set(i + 1, {
    delivery: i + 1, brushId: makeBrushId(stratum, bx, by), stratum,
    from: 0, through, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
  }));
}

function heldIds(sink: DeliverySink): bigint[] {
  return [...sink.book.byDelivery.values()].map((r) => r.brushId);
}

describe('eviction keeps the current cone (spec 5.2.3: outside the cone first)', () => {
  it('a full book with the core whole evicts only outside the cone, and keeps the rings the server would re-send', () => {
    const client = fakeClient();
    const all = [...CORE, ...RINGS, ...FAR];
    const sink = makeSink({ client, maxBrushes: all.length });
    sink.setExtent(16384, 16384);
    hold(sink, all);
    sink.setView(0, 0, 512, 512, 512, 512);

    const ids = heldIds(sink);
    for (const [s, x, y] of [...CORE, ...RINGS]) expect(ids).toContain(makeBrushId(s, x, y));
    expect(sink.eviction.evicted).toBe(FAR.length); // 75 % of 25 is unreachable: nothing more goes
    expect(client.sentRelease.flatMap((r) => r.ranges).every((n) => n > CORE.length + RINGS.length)).toBe(true);
    sink.dispose();
  });

  it('a full book missing core brushes gives up just as many ring brushes, never the core', () => {
    const client = fakeClient();
    const present = [...CORE.slice(3), ...RINGS]; // three stratum-0 core tiles not held
    const sink = makeSink({ client, maxBrushes: present.length });
    sink.setExtent(16384, 16384);
    hold(sink, present);
    sink.setView(0, 0, 512, 512, 512, 512);

    expect(sink.eviction.evicted).toBe(3);
    const ids = heldIds(sink);
    for (const [s, x, y] of CORE.slice(3)) expect(ids).toContain(makeBrushId(s, x, y));
    expect(client.sentReceipt.at(-1)?.free).toBe(3); // the window reopens for the missing core
    sink.dispose();
  });

  it('a full book holding the core at 2 bands makes room for the upgrades (the plan would stall at libre 0)', () => {
    const client = fakeClient();
    const all = [...CORE, ...RINGS];
    const sink = makeSink({ client, maxBrushes: all.length });
    sink.setExtent(16384, 16384);
    hold(sink, all, 2);
    sink.setView(0, 0, 512, 512, 512, 512);

    expect(sink.eviction.evicted).toBe(RINGS.length); // 13 core upgrades owed, the 6 rings give way
    const ids = heldIds(sink);
    for (const [s, x, y] of CORE) expect(ids).toContain(makeBrushId(s, x, y));
    expect(client.sentReceipt.at(-1)?.free).toBe(RINGS.length);
    sink.dispose();
  });
});

describe('focusBands (ConePlanner focus target)', () => {
  it('is full on a stratum boundary and drops a band per quarter stratum toward the next', () => {
    expect(focusBands(0, 0, null)).toBe(4);
    expect(focusBands(-1, 0, null)).toBe(4);
    expect(focusBands(2.3, 2, null)).toBe(3);
    expect(focusBands(2.8, 2, null)).toBe(1);
  });

  it('a focus clamped by min_estrato wants every band, capped by max_bandas there', () => {
    const grant = { epoch: 1, minStratum: 3, maxBands: 2 };
    expect(focusBands(1.6, 3, grant)).toBe(2);
    expect(focusBands(1.6, 3, { ...grant, maxBands: 4 })).toBe(4);
    expect(focusBands(3.1, 3, grant)).toBe(2);
    expect(focusBands(4.1, 4, grant)).toBe(4);
  });
});

describe('coreMissing', () => {
  const state = (): SinkState => new SinkState(1, () => null, { maxKiB: () => 1e6, maxBrushes: () => 768 }, 192, 160, 11, 1,
    () => new FakeWorker() as unknown as SynthWorker);

  it('counts the view tiles at the focus stratum and every coarser one that the book lacks', () => {
    const s = state();
    s.extent = { w: 16384, h: 16384 };
    s.view = { x0: 0, y0: 0, x1: 512, y1: 512, focus: 0 };
    expect(coreMissing(s)).toBe(13);
    s.book.byDelivery.set(1, {
      delivery: 1, brushId: makeBrushId(0, 1, 1), stratum: 0,
      from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
    });
    expect(coreMissing(s)).toBe(12);
    s.focusBands = 2;
    s.book.byDelivery.set(1, { ...s.book.byDelivery.get(1)!, through: 2 });
    expect(coreMissing(s)).toBe(12); // two bands are all the focus wants
    s.book.byDelivery.set(2, { ...s.book.byDelivery.get(1)!, delivery: 2, brushId: makeBrushId(1, 0, 0), stratum: 1 });
    expect(coreMissing(s)).toBe(12); // an ancestor at two bands still owes the rest
  });

  it('clips to the work like the server tiling: no brush past the edge is missing', () => {
    const s = state();
    s.extent = { w: 300, h: 300 };
    s.view = { x0: -100, y0: -100, x1: 1024, y1: 1024, focus: 0 };
    expect(coreMissing(s)).toBe(4 + 9);
    s.view = { x0: 400, y0: 400, x1: 900, y1: 900, focus: 0 };
    expect(coreMissing(s)).toBe(0);
  });
});
