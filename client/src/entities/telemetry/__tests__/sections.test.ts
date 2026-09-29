import { describe, expect, it } from 'vitest';
import { ImageTelemetry } from '../image-telemetry';
import { telemetrySections } from '../sections';
import { PENDING, type HeldBrush } from '../types';
import { fmtBytes, fmtMs, fmtRate } from '@/shared/lib/format-units';
import { RateMeter } from '@/shared/lib/rate-meter';

function rec(stratum: number, bytes: number, decoded: boolean): HeldBrush {
  return { stratum, bytes, rgba: decoded ? { width: 256, height: 256 } : null };
}

function rows(title: string, sections: ReturnType<typeof telemetrySections>): Record<string, string> {
  const s = sections.find((x) => x.title === title);
  return Object.fromEntries((s?.rows ?? []).map((r) => [r.k, r.v]));
}

describe('telemetry sections', () => {
  const book = { byDelivery: new Map<number, HeldBrush>(), inFlight: new Set<number>() };
  book.byDelivery.set(1, rec(10, 16_000, false));
  book.byDelivery.set(2, rec(0, 40_000, true));
  book.inFlight.add(3);
  const link = new RateMeter();
  for (let t = 0; t < 2000; t += 100) link.record(6400, t);
  const image = new ImageTelemetry(7, 0);
  image.onPlan({ handle: 7, gazeSeq: 4, event: 0, first: 2, expectedCount: 4, throttle: 2 }, 100);
  image.onDelivery(40_000, 2, 300);
  image.onDelivery(9_000, 3, 400);
  const sections = telemetrySections({
    now: 2000, transport: 'websocket', link, image,
    sink: {
      book, free: () => 3, queueDepthMs: 12, strata: 3, workerCacheBound: 1_000_000,
      eviction: { evicted: 8, evictedBytes: 64_000, refetched: 2, refetchedBytes: 16_000, medianRefetchMs: 1500 },
    },
    gpuBytes: 2_000_000, declaredMemMiB: 64,
    concession: { handle: 7, epoch: 1, minStratum: 0, maxBands: 4, reason: 0, maxBrushes: 768, maxKiB: 36_864, leaseS: 120 },
  });

  it('adds bands, planes, bitmaps, GPU textures and the worker caches into the viewer estimate', () => {
    const m = rows('Stored on this device', sections);
    expect(m['Viewer memory (est.)']).toBe(`${fmtBytes(56_000 + 256 * 256 * 4 + 2_000_000 + 1_000_000)} of 64 MiB declared`);
    expect(m['Brushes held']).toBe('2 of 768');
    expect(m['In flight']).toBe('1');
  });

  it('shows the data behind the held brushes and the mean per brush, or a placeholder when none is held', () => {
    const total = 56_000 + 256 * 256 * 4;
    expect(rows('Stored on this device', sections)['Brush data']).toBe(`${fmtBytes(total)} · ${fmtBytes(total / 2)} / brush`);
    const none = telemetrySections({
      now: 0, transport: null, link: null, image: null, concession: null,
      sink: { book: { byDelivery: new Map(), inFlight: new Set() }, free: () => 0, queueDepthMs: 0, strata: 3, workerCacheBound: 0,
        eviction: { evicted: 0, evictedBytes: 0, refetched: 0, refetchedBytes: 0, medianRefetchMs: null } },
    });
    expect(rows('Stored on this device', none)['Brush data']).toBe(PENDING);
  });

  it('reports what eviction dropped and how much of it came back', () => {
    const m = rows('Eviction', sections);
    expect(m['Evicted since open']).toBe(`8 · ${fmtBytes(64_000)}`);
    expect(m['Re-sent within 60 s']).toBe(`2 · ${fmtBytes(16_000)} · 25%`);
    expect(m['Median time to refetch']).toBe(fmtMs(1500));
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

  it('lists every level of the work, empty ones too, finest first', () => {
    const m = rows('Detail by level', sections);
    expect(Object.keys(m)).toEqual(['Level 0 (1:1)', 'Level 1 (1:2)', 'Seed', 'Finest allowed']);
    expect(m['Level 1 (1:2)']).toBe('0 · 0 B');
  });

  it('keeps every row in place with a placeholder before anything is known', () => {
    const empty = telemetrySections({ now: 0, transport: null, link: null, image: null, sink: null, concession: null });
    const full = sections.filter((s) => s.title !== 'Detail by level');
    expect(empty.map((s) => s.rows.map((r) => r.k))).toEqual(full.map((s) => s.rows.map((r) => r.k)));
    expect(empty.every((s) => s.rows.every((r) => r.v === PENDING))).toBe(true);
  });
});

describe('telemetry formats', () => {
  it('shows bytes at three significant digits, rolling units before a fourth digit', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(5_837)).toBe('5.70 KiB');
    expect(fmtBytes(81_613)).toBe('79.7 KiB');
    expect(fmtBytes(348_160)).toBe('340 KiB');
    expect(fmtBytes(1_022_000)).toBe('998 KiB');
    expect(fmtBytes(1_030_000)).toBe('0.98 MiB');
    expect(fmtBytes(46_451_000)).toBe('44.3 MiB');
    expect(fmtBytes(3 * 1024 ** 3)).toBe('3.00 GiB');
  });

  it('shows rates in bits and bytes at the same precision', () => {
    expect(fmtRate(0)).toBe('0 kbit/s · 0 B/s');
    expect(fmtRate(95_250)).toBe('762 kbit/s · 93.0 KiB/s');
    expect(fmtRate(262_500)).toBe('2.10 Mbit/s · 256 KiB/s');
  });

  it('shows durations in whole ms, then seconds', () => {
    expect(fmtMs(12.4)).toBe('12 ms');
    expect(fmtMs(1_530)).toBe('1.53 s');
  });
});
