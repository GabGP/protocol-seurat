import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GazeSender } from '@/features/send-gaze';
import type { SeuratTransport } from '@/shared/api/transport';

function fakeTransport(supportsDatagrams: boolean) {
  const t = {
    supportsDatagrams,
    control: [] as Uint8Array[],
    datagrams: [] as Uint8Array[],
    sendControl(f: Uint8Array): void {
      this.control.push(f);
    },
    sendGazeDatagram(p: Uint8Array): void {
      this.datagrams.push(p);
    },
  };
  return t;
}

const base = { handle: 1, x0: 0, y0: 0, x1: 100, y1: 100, vw: 200, vh: 200, flags: 0 };

describe('send-gaze', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces motion to one datagram per frame, last wins', () => {
    const t = fakeTransport(true);
    const s = new GazeSender(() => t as unknown as SeuratTransport);
    s.motion({ ...base, x1: 100 });
    s.motion({ ...base, x1: 200 });
    s.motion({ ...base, x1: 300 });
    expect(t.datagrams.length).toBe(0);
    vi.advanceTimersByTime(16);
    expect(t.datagrams.length).toBe(1);
    s.dispose();
  });

  it('sends reliable QUIETA copy after 300ms idle', () => {
    const t = fakeTransport(true);
    const s = new GazeSender(() => t as unknown as SeuratTransport);
    s.motion(base);
    vi.advanceTimersByTime(16);
    expect(t.control.length).toBe(0);
    vi.advanceTimersByTime(300);
    expect(t.control.length).toBe(1);
    s.dispose();
  });

  it('OCULTA goes reliable on the control channel', () => {
    const t = fakeTransport(true);
    const s = new GazeSender(() => t as unknown as SeuratTransport);
    s.hidden(1);
    expect(t.control.length).toBe(1);
    expect(t.datagrams.length).toBe(0);
    s.dispose();
  });

  it('dispatches initial gaze without prior motion on first flush', () => {
    const t = fakeTransport(false);
    const s = new GazeSender(() => t as unknown as SeuratTransport);
    s.motion({ handle: 42, x0: 0, y0: 0, x1: 4096, y1: 3072, vw: 1920, vh: 1080, flags: 0 });
    expect(t.datagrams.length).toBe(0);
    vi.advanceTimersByTime(16);
    expect(t.datagrams.length).toBe(1);
    // After idle interval, still/quiet gaze is promoted to reliable control channel
    vi.advanceTimersByTime(300);
    expect(t.control.length).toBe(1);
    s.dispose();
  });

  it('every view a MIRADA describes reaches onLook with its seq, before anything is sent', () => {
    const t = fakeTransport(true);
    const seen: [number, number][] = [];
    const s = new GazeSender(() => t as unknown as SeuratTransport, (m) => seen.push([m.seq, m.x1]));
    s.motion({ ...base, x1: 100 });
    expect(seen).toEqual([[1, 100]]);
    expect(t.datagrams.length).toBe(0);
    s.still({ ...base, x1: 200 });
    s.again();
    expect(seen).toEqual([[1, 100], [2, 200], [3, 200]]);
    expect(s.lastSeq).toBe(3);
    s.dispose();
  });

  it('forget drops the pending view and the remembered one: nothing goes out for a closed handle', () => {
    const t = fakeTransport(true);
    const s = new GazeSender(() => t as unknown as SeuratTransport);
    s.motion({ ...base });
    s.forget(1);
    vi.advanceTimersByTime(1000);
    s.again();
    s.motion({ ...base }); // a render frame with the stale handle
    s.still({ ...base });
    s.hidden(1);
    vi.advanceTimersByTime(1000);
    expect(t.datagrams.length + t.control.length).toBe(0);
    s.motion({ ...base, handle: 2 });
    vi.advanceTimersByTime(16);
    expect(t.datagrams.length).toBe(1);
    s.dispose();
  });
});
