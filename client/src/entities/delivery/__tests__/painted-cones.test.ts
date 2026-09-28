import { describe, expect, it } from 'vitest';
import { DeliverySink } from '@/app/providers/delivery-sink';
import { makeBrushId } from '@/shared/proto/brush';
import type { SessionClient } from '@/app/providers/session-client';
import { PaintedCones } from '../painted-cones';

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

  it('forgets the oldest past views beyond its bound', () => {
    const cones = new PaintedCones();
    for (let seq = 1; seq <= 40; seq++) cones.look(view(seq), seq);
    expect(cones.views(() => false).length).toBeLessThanOrEqual(17);
  });
});

describe('DeliverySink eviction while the old plan is still landing', () => {
  it('never evicts a parent the server may still send children for, then does once they settle', () => {
    const sentRelease: Array<{ reason: number; ranges: number[] }> = [];
    const client = {
      sendRelease: (_h: number, reason: number, ranges: number[]) => sentRelease.push({ reason, ranges }),
      sendReceipt: () => undefined,
    } as unknown as SessionClient;
    const sink = new DeliverySink(1, () => client, () => 36864, () => 40);
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
});
