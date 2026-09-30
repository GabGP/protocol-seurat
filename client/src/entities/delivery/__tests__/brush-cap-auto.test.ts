import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRUSH_CAP_AUTO, DEFAULT_STRATA, BRUSH_CAP_AUTO_FLOOR_K, BRUSH_CAP_AUTO_K, BRUSH_CAP_AUTO_MAX, BRUSH_CAP_AUTO_MIN, BRUSH_CAP_KEY } from '@/shared/config/constants';
import { makeBrushId } from '@/shared/proto/brush';
import type { DeliveryRecord } from '../store';

const VIEWPORTS: ReadonlyArray<readonly [number, number]> = [
  [320, 240], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320],
];

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

let cap: typeof import('../brush-cap');
let storage: Storage;

beforeEach(async () => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.resetModules();
  cap = await import('../brush-cap');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('auto brush cap', () => {
  it('is round(K x brushes per screen) between the bounds', () => {
    expect(cap.brushesPerScreen(1920, 1080)).toBe(9 * 6);
    expect(cap.autoCap(1920, 1080)).toBe(Math.round(BRUSH_CAP_AUTO_K * 54));
    expect(cap.autoCap(320, 240)).toBe(BRUSH_CAP_AUTO_MIN);
    expect(cap.autoCap(2560, 1440)).toBe(Math.round(BRUSH_CAP_AUTO_K * 77));
    expect(cap.autoCap(3840, 2160)).toBe(BRUSH_CAP_AUTO_MAX);
  });

  it('grows with the screen', () => {
    const caps = VIEWPORTS.map(([w, h]) => cap.autoCap(w, h));
    expect(caps).toEqual([...caps].sort((a, b) => a - b));
    expect(new Set(caps).size).toBeGreaterThan(3);
  });

  it('never drops below the core at the focus plus the first ring, the sketch and the coarse strata, at any size (4K and 8K included)', () => {
    for (const [w, h] of VIEWPORTS) expect(cap.autoCap(w, h)).toBeGreaterThanOrEqual(BRUSH_CAP_AUTO_FLOOR_K * cap.brushesPerScreen(w, h) + DEFAULT_STRATA + 1);
  });

  it('is what brushCap() answers until the user chooses, and follows the viewport', () => {
    expect(cap.capChoice()).toBe(BRUSH_CAP_AUTO);
    const seen = vi.fn();
    cap.onBrushCap(seen);
    cap.setViewport(1920, 1080);
    expect(cap.brushCap()).toBe(cap.autoCap(1920, 1080));
    expect(cap.autoBrushCap()).toBe(cap.autoCap(1920, 1080));
    cap.setViewport(1920, 1080);
    expect(seen).toHaveBeenCalledOnce();
    cap.setViewport(3840, 2160);
    expect(cap.brushCap()).toBe(cap.autoCap(3840, 2160));
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it('an explicit choice wins, is remembered, and Auto forgets it', () => {
    cap.setViewport(1920, 1080);
    cap.setBrushCap(512);
    cap.setViewport(3840, 2160);
    expect(cap.brushCap()).toBe(512);
    expect(storage.getItem(BRUSH_CAP_KEY)).toBe('512');
    cap.setBrushCap(BRUSH_CAP_AUTO);
    expect(storage.getItem(BRUSH_CAP_KEY)).toBeNull();
    expect(cap.capChoice()).toBe(BRUSH_CAP_AUTO);
    expect(cap.brushCap()).toBe(cap.autoCap(3840, 2160));
  });
});

const rec = (delivery: number): DeliveryRecord => ({
  delivery, brushId: makeBrushId(0, delivery, 0), stratum: 0, from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
});

describe('a sink under the auto cap', () => {
  it('reads the viewport from its view; a smaller screen relieves through onBrushCap (SOLTAR 1)', async () => {
    const { makeSink } = await import('../testing/make-sink');
    const { fakeClient } = await import('../testing/fake-port');
    const client = fakeClient();
    const sink = makeSink({ client, maxBrushes: 768 });
    const off = cap.onBrushCap(() => sink.relieveNow());
    sink.setView(0, 0, 3840, 2160, 3840, 2160);
    expect(cap.brushCap()).toBe(cap.autoCap(3840, 2160));
    for (let n = 1; n <= 200; n++) sink.book.byDelivery.set(n, rec(n));
    sink.setView(0, 0, 3840, 2160, 3840, 2160);
    expect(client.sentRelease).toEqual([]);
    sink.setView(0, 0, 1280, 720, 1280, 720);
    expect(cap.brushCap()).toBe(cap.autoCap(1280, 720));
    expect(client.sentRelease.length).toBeGreaterThan(0);
    expect(sink.book.byDelivery.size).toBeLessThan(200);
    off();
    sink.dispose();
  });
});
