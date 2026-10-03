import { afterEach, describe, expect, it, vi } from 'vitest';
import { BRUSH_CAP_DEFAULT, BRUSH_CAP_KEY } from '@/shared/config/constants';
import { makeBrushId } from '@/shared/proto/brush';
import { onBrushCap, setBrushCap } from '../brush-cap';
import { refuse } from '../sink/refusal';
import { SinkState } from '../sink/state';
import type { DeliveryRecord } from '../store';
import { fakeClient } from '../testing/fake-port';
import { FakeWorker } from '../testing/fake-worker';
import { makeSink } from '../testing/make-sink';
import type { SynthWorker } from '../worker-pool';

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

const rec = (delivery: number, bx: number): DeliveryRecord => ({
  delivery, brushId: makeBrushId(0, bx, 0), stratum: 0, from: 0, through: 4, bytes: 10, epoch: 1, edition: 1, expires: 1e12, rgba: null,
});

afterEach(() => {
  setBrushCap(BRUSH_CAP_DEFAULT);
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('brush cap', () => {
  it('defaults, round-trips through localStorage and tells subscribers', async () => {
    const storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.resetModules();
    const first = await import('../brush-cap');
    expect(first.brushCap()).toBe(BRUSH_CAP_DEFAULT);
    const seen = vi.fn();
    const off = first.onBrushCap(seen);
    first.setBrushCap(181);
    first.setBrushCap(181);
    expect(seen).toHaveBeenCalledOnce();
    expect(storage.getItem(BRUSH_CAP_KEY)).toBe('181');
    off();
    first.setBrushCap(512);
    expect(seen).toHaveBeenCalledOnce();
    vi.resetModules();
    expect((await import('../brush-cap')).brushCap()).toBe(512);
  });

  it('ignores a garbage stored value and works without storage', async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    localStorage.setItem(BRUSH_CAP_KEY, 'abc');
    vi.resetModules();
    expect((await import('../brush-cap')).brushCap()).toBe(BRUSH_CAP_DEFAULT);
    expect(onBrushCap(() => undefined)).toBeTypeOf('function');
  });

  it('RECIBO.libre never exceeds cap - held, even with a bigger concession', () => {
    const sink = makeSink({ maxBrushes: 768 });
    for (let n = 1; n <= 100; n++) sink.book.byDelivery.set(n, rec(n, n));
    setBrushCap(181);
    expect(sink.free()).toBeLessThanOrEqual(81);
    setBrushCap(100);
    expect(sink.free()).toBe(0);
    sink.dispose();
  });

  it('relieve evicts down to the cap and a RECIBO reports the window (SOLTAR 1 first)', () => {
    const client = fakeClient();
    const sink = makeSink({ client, maxBrushes: 768 });
    for (let bx = 0; bx < 36; bx++) sink.book.byDelivery.set(bx + 1, rec(bx + 1, bx));
    sink.setView(0, 0, 512, 512, 512, 512); // 36 of a 362 cap: no pressure
    expect(client.sentRelease).toEqual([]);
    setBrushCap(40);
    sink.relieveNow();
    expect(client.sentRelease).toEqual([{ handle: 1, reason: 1, ranges: [31, 32, 33, 34, 35, 36] }]);
    expect(client.sentReceipt.at(-1)?.free).toBe(8);
    sink.dispose();
  });

  it('a wider cap reopens the window without evicting', () => {
    const client = fakeClient();
    const sink = makeSink({ client, maxBrushes: 768 });
    for (let bx = 0; bx < 36; bx++) sink.book.byDelivery.set(bx + 1, rec(bx + 1, bx));
    setBrushCap(24);
    sink.relieveNow();
    const narrow = client.sentReceipt.at(-1)?.free ?? 0;
    setBrushCap(512);
    sink.relieveNow();
    expect(client.sentRelease.length).toBeLessThanOrEqual(1);
    expect(client.sentReceipt.at(-1)?.free).toBeGreaterThan(narrow);
    sink.dispose();
  });

  it('the arrival check still uses the concession, not the cap (spec 5.4)', () => {
    const state = (max: number): SinkState => {
      const s = new SinkState(1, () => null, { maxKiB: () => 1e6, maxBrushes: () => max }, 192, 160, 11, 1,
        () => new FakeWorker() as unknown as SynthWorker);
      for (let n = 1; n <= 50; n++) s.book.byDelivery.set(n, rec(n, n));
      return s;
    };
    setBrushCap(40);
    const over = state(768); // 50 held, cap 40: the concession still has room, so the arrival is accepted
    expect(refuse(over, rec(99, 99), 10)).toBeNull();
    expect(over.book.byDelivery.size).toBe(50); // the check itself evicts nothing
  });
});
