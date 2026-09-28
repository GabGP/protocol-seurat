import { describe, expect, it } from 'vitest';
import { emptyLedger, type DeliveryRecord } from '@/entities/delivery/store';
import { ImageTelemetry } from '@/entities/telemetry/image-telemetry';
import { fmtBytes, fmtRate, telemetrySections } from '@/entities/telemetry/sections';
import { RateMeter } from '@/shared/lib/rate-meter';

function rec(delivery: number, stratum: number, bytes: number, decoded: boolean): DeliveryRecord {
  return {
    delivery, brushId: BigInt(delivery), stratum, from: 0, through: 2, bytes, epoch: 1, edition: 2,
    expires: 0, rgba: decoded ? ({ width: 256, height: 256 } as ImageBitmap) : null,
  };
}

function rows(title: string, sections: ReturnType<typeof telemetrySections>): Record<string, string> {
  const s = sections.find((x) => x.title === title);
  return Object.fromEntries((s?.rows ?? []).map((r) => [r.k, r.v]));
}

describe('telemetry sections', () => {
  const book = emptyLedger();
  book.byDelivery.set(1, rec(1, 10, 16_000, false));
  book.byDelivery.set(2, rec(2, 0, 40_000, true));
  book.inFlight.add(3);
  const link = new RateMeter();
  for (let t = 0; t < 2000; t += 100) link.record(6400, t);
  const image = new ImageTelemetry(7, 0);
  image.onPlan({ handle: 7, gazeSeq: 4, event: 0, first: 2, expectedCount: 4, throttle: 2 }, 100);
  image.onDelivery(40_000, 2, 300);
  image.onDelivery(9_000, 3, 400);
  const sections = telemetrySections({
    now: 2000, transport: 'websocket', link, image,
    sink: { book, free: () => 3, queueDepthMs: 12 },
    concession: { handle: 7, epoch: 1, minStratum: 0, maxBands: 4, reason: 0, maxBrushes: 768, maxKiB: 36_864, leaseS: 120 },
  });

  it('adds compressed bands and decoded pixels into what the device holds', () => {
    const m = rows('Stored on this device', sections);
    expect(m['Total in memory']).toBe(fmtBytes(56_000 + 256 * 256 * 4));
    expect(m['Brushes held']).toBe('2 of 768');
    expect(m['In flight']).toBe('1');
  });

  it('shows the link peak and the paced receiver window (the current rate is the graph caption)', () => {
    const m = rows('Link', sections);
    expect(m['Current bandwidth']).toBeUndefined();
    expect(m['Link peak (10 s)']).toBe(fmtRate(link.peak(2000)));
    expect(m['Receiver window']).toBe('3 brushes');
  });

  it('tracks the current plan and why it was throttled', () => {
    const m = rows('Current view', sections);
    expect(m['Plan']).toBe('#4 · 2 of 4 brushes (50%)');
    expect(m['Throttled by']).toBe('fine-detail budget');
  });

  it('breaks detail down by level, finest first', () => {
    const keys = Object.keys(rows('Detail by level', sections));
    expect(keys).toEqual(['Level 0 (1:1)', 'Seed', 'Finest allowed']);
  });
});
