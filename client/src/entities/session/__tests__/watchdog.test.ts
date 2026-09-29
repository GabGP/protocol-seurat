import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeuratTransport } from '@/shared/api/transport';
import { HEARTBEAT_MISSES, HEARTBEAT_S } from '@/shared/config/session';
import { encodeFrame } from '@/shared/proto/frame';
import { T, heartbeatCore } from '@/shared/proto/messages';
import { SessionClient } from '../client/session-client';

const SILENCE_MS = HEARTBEAT_MISSES * HEARTBEAT_S * 1000;

function link() {
  let closed = 0;
  const t: SeuratTransport = {
    name: 'websocket', supportsDatagrams: false, onControl: null, onDelivery: null, onClose: null,
    sendControl() {}, sendGazeDatagram() {}, close() { closed += 1; },
  };
  const seen = { disconnects: 0, status: [] as string[] };
  const client = new SessionClient({
    onWelcome() {}, onWork() {}, onWorkOpened() {}, onConcession() {}, onPlan() {}, onScrape() {}, onRenew() {},
    onAudit() {}, onProtocolError() {}, onDelivery() {},
    onStatus: (s) => { seen.status.push(s); },
    onDisconnect: () => { seen.disconnects += 1; },
  });
  client.wire(t);
  return { t, client, seen, closes: () => closed };
}

describe('link watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes a link that stays silent for 3 heartbeats and asks to resume, once', () => {
    const { t, client, seen, closes } = link();
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(seen.disconnects).toBe(0);
    vi.advanceTimersByTime(1);
    expect(seen.disconnects).toBe(1);
    expect(closes()).toBe(1);
    expect(seen.status).toEqual(['closed silent']);
    expect(client.connected).toBe(false);
    t.onClose?.('late close event'); // the half-open socket finally reports: nothing new to say
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(seen.disconnects).toBe(1);
    expect(seen.status).toEqual(['closed silent']);
  });

  it('any frame restarts the countdown', () => {
    const { t, seen } = link();
    for (let i = 0; i < HEARTBEAT_MISSES + 2; i++) {
      vi.advanceTimersByTime(SILENCE_MS - 1);
      t.onControl?.(encodeFrame(T.LATIDO, heartbeatCore(BigInt(i))));
    }
    expect(seen.disconnects).toBe(0);
    vi.advanceTimersByTime(SILENCE_MS);
    expect(seen.disconnects).toBe(1);
  });

  it('a real close stops the watchdog and dispose silences it', () => {
    const a = link();
    a.t.onClose?.('gone');
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(a.seen.disconnects).toBe(1);
    expect(a.closes()).toBe(0);
    const b = link();
    b.client.dispose();
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(b.seen.disconnects).toBe(0);
  });
});
