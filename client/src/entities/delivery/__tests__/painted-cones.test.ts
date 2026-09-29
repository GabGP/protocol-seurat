import { describe, expect, it } from 'vitest';
import { makeBrushId } from '@/shared/proto/brush';
import type { DeliveryPort } from '../sink/port';
import { PaintedCones } from '../painted-cones';
import { makeSink } from '../testing/make-sink';

const view = (x0: number): { x0: number; y0: number; x1: number; y1: number; focus: number } =>
  ({ x0, y0: 0, x1: x0 + 512, y1: 512, focus: 0 });

describe('PaintedCones', () => {
  it('keeps a past view until a later plan started and every number below it settled', () => {
    const cones = new PaintedCones();
    cones.look(view(0), 1);
    cones.look(view(1000), 2);
    expect(cones.views(() => true)).toEqual([view(1000), view(0)]); // no PLAN INICIO for seq 2 yet
    cones.planStart(1, 10); // a plan for the old view itself retires nothing
    expect(cones.views(() => true)).toHaveLength(2);
    cones.planStart(2, 40);
    expect(cones.views(() => false)).toHaveLength(2); // flows below 40 still on the way
    expect(cones.views((n) => n === 40)).toEqual([view(1000)]);
  });

  it('merges the views of a drag no plan answered yet into one cone covering them all', () => {
    const cones = new PaintedCones();
    for (let seq = 1; seq <= 60; seq++) cones.look(view(seq * 100), seq); // one view per frame
    const views = cones.views(() => false);
    expect(views).toHaveLength(2);
    expect(views[1]).toEqual({ x0: 100, y0: 0, x1: 5900 + 512, y1: 512, focus: 0 });
  });

  it('past its bound it merges the oldest cones instead of dropping one', () => {
    const cones = new PaintedCones();
    for (let seq = 1; seq <= 40; seq++) {
      cones.look(view(seq * 1000), seq);
      cones.planStart(seq, seq * 10); // every view answered, none of it settled yet
    }
    const views = cones.views(() => false);
    expect(views.length).toBeLessThanOrEqual(17);
    for (let seq = 1; seq < 40; seq++) {
      expect(views.some((v) => v.x0 <= seq * 1000 && v.x1 >= seq * 1000 + 512)).toBe(true);
    }
  });
});

describe('DeliverySink eviction while the old plan is still landing', () => {
  it('never evicts a parent the server may still send children for, then does once they settle', () => {
    const sentRelease: Array<{ reason: number; ranges: number[] }> = [];
    const client = {
      sendRelease: (_h: number, reason: number, ranges: number[]) => sentRelease.push({ reason, ranges }),
      sendReceipt: () => undefined,
    } as unknown as DeliveryPort;
    const sink = makeSink({ client, maxBrushes: 40 });
    for (let bx = 0; bx < 36; bx++) { // a row of level-0 brushes; delivery n = bx + 1
      sink.book.byDelivery.set(bx + 1, {
        delivery: bx + 1, brushId: makeBrushId(0, bx, 0), stratum: 0,
        from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    }
    sink.setView(30 * 256, 0, 36 * 256, 256, 1536, 256, 1); // looking at bx 30..35
    sink.setView(0, 0, 512, 512, 512, 512, 2); // moved to bx 0..1: the old plan may still be landing
    const first = sentRelease.flatMap((r) => r.ranges);
    expect(first).toHaveLength(6);
    expect(first.some((n) => n >= 31)).toBe(false);

    sink.planStart(37, 2); // the plan for seq 2 started: every older number is settled
    sink.reportVramFailure();
    expect(sentRelease.at(-1)?.ranges).toEqual(expect.arrayContaining([31, 32, 33, 34, 35, 36]));
    sink.dispose();
  });

  /** 20 core brushes, 5 ring ones and `far` ones out of every cone, of `kib` each: what eviction releases. */
  const run = (max: number, maxKiB = 36864, kib = 0, far = 0): number[] => {
    const released: number[] = [];
    const client = {
      sendRelease: (_h: number, _r: number, ranges: number[]) => released.push(...ranges),
      sendReceipt: () => undefined,
    } as unknown as DeliveryPort;
    const sink = makeSink({ client, maxKiB, maxBrushes: max });
    const hold = (n: number, stratum: number, bx: number): void => {
      sink.book.byDelivery.set(n, {
        delivery: n, brushId: makeBrushId(stratum, bx, 0), stratum,
        from: 0, through: 4, bytes: kib * 1024 || 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
      });
    };
    for (let bx = 0; bx < 20; bx++) hold(bx + 1, 0, bx); // the focus: core
    for (let bx = 10; bx < 15; bx++) hold(bx + 11, 1, bx); // ring 1 beyond the view: cone, not core
    for (let i = 0; i < far; i++) hold(26 + i, 0, 200 + i); // long left behind
    sink.setView(0, 0, 20 * 256, 256, 20 * 256, 256, 1);
    sink.dispose();
    return released.sort((a, b) => a - b);
  };

  it('with the book full nothing is on the wire: ring brushes go, the core stays', () => {
    expect(run(26)).toEqual([]); // not full: the ring's children may be on the wire
    expect(run(25)).toEqual([21, 22, 23, 24, 25]);
  });

  it('with max_kib spent but the book not full the cone stays: its children may be on the wire', () => {
    expect(run(1000, 6600, 240)).toEqual([]); // 6000 of 6600 KiB, over 90 %
  });

  it('a byte window closed below 90 % of max_kib still evicts, so libre reopens instead of staying 0', () => {
    // 6480 of 7380 KiB (88 %): 900 KiB take 18 per-brush shares, 12 of them for the wire: fewer than 8 left
    // Once relieving, it goes on to 75 %: both far brushes; the cone and the core stay.
    expect(run(1000, 7380, 240, 2)).toEqual([26, 27]);
    expect(run(1000, 7380 + 240, 240, 2)).toEqual([]); // 1140 KiB: 23 − 12 = 11 shares, no pressure
  });
});
