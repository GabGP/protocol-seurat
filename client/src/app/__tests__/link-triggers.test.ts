import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RECONNECT_BASE_MS } from '@/shared/config/constants';
import { watchLink, type LinkEnv } from '../providers/seurat/link-triggers';
import { createReconnect } from '../providers/seurat/reconnect';
import type { Runtime } from '../providers/seurat/runtime';

const rtWith = (client: object | null): Runtime => ({ client } as unknown as Runtime);

function env(): LinkEnv & { doc: EventTarget & { visibilityState: string } } {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
  return { win: new EventTarget(), doc };
}

describe('link triggers', () => {
  it('online and becoming visible reconnect only a client that is not live', () => {
    const client = { connected: false, failed: false };
    const reconnect = vi.fn();
    const e = env();
    const off = watchLink(rtWith(client), reconnect, e);
    e.win.dispatchEvent(new Event('online'));
    expect(reconnect).toHaveBeenCalledTimes(1);
    e.doc.dispatchEvent(new Event('visibilitychange')); // still hidden
    expect(reconnect).toHaveBeenCalledTimes(1);
    e.doc.visibilityState = 'visible';
    e.doc.dispatchEvent(new Event('visibilitychange'));
    expect(reconnect).toHaveBeenCalledTimes(2);
    client.connected = true;
    e.win.dispatchEvent(new Event('online'));
    e.doc.dispatchEvent(new Event('visibilitychange'));
    client.connected = false;
    client.failed = true; // a fatal ERROR needs a fresh start, not a resume
    e.win.dispatchEvent(new Event('online'));
    expect(reconnect).toHaveBeenCalledTimes(2);
    off();
    client.failed = false;
    e.win.dispatchEvent(new Event('online'));
    e.doc.dispatchEvent(new Event('visibilitychange'));
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it('pageshow reconnects only when restored from the bfcache', () => {
    const reconnect = vi.fn();
    const e = env();
    watchLink(rtWith({ connected: false, failed: false }), reconnect, e);
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    expect(reconnect).not.toHaveBeenCalled();
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });
});

describe('reconnect back-off', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps growing until BIENVENIDA, not until boot resolves', async () => {
    let boots = 0;
    const client = { boot: () => { boots += 1; return Promise.reject(new Error('down')); }, requestCatalog() {} };
    const rt = { alive: true, client, sink: null, preview: null, resuming: null } as unknown as Runtime;
    const link = createReconnect(rt);
    link.run();
    await vi.advanceTimersByTimeAsync(0);
    expect(boots).toBe(1);
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 2 - 1);
    expect(boots).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(boots).toBe(2); // second failure: 4 x base next
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 4 - 1);
    expect(boots).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(boots).toBe(3);
    link.welcomed(); // the server answered: the next failure starts from the base again
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 8);
    expect(boots).toBe(4);
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 2);
    expect(boots).toBe(5);
  });

  it('a trigger replaces a pending back-off instead of doubling the attempt', async () => {
    let boots = 0;
    const client = { boot: () => { boots += 1; return Promise.reject(new Error('down')); }, requestCatalog() {} };
    const rt = { alive: true, client, sink: null, preview: null, resuming: null } as unknown as Runtime;
    const link = createReconnect(rt);
    link.run();
    await vi.advanceTimersByTimeAsync(0);
    link.run(); // e.g. `online`
    await vi.advanceTimersByTimeAsync(0);
    expect(boots).toBe(2);
    await vi.advanceTimersByTimeAsync(RECONNECT_BASE_MS * 4);
    expect(boots).toBe(3); // one timer, not two
  });
});
