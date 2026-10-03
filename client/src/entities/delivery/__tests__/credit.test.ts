import { describe, expect, it } from 'vitest';
import { byteRoom, coming, receiverWindow, synthesisHorizon } from '../credit';
import { KIB_PER_BRUSH, WIRE_FLOWS } from '@/shared/config/constants';

describe('receiverWindow (RECIBO.libre)', () => {
  it('keeps about one second of brushes on a 512 kbit/s link', () => {
    expect(receiverWindow(768, 64_000, 26_000)).toBe(3);
  });

  it('never drops below two, so one brush arrives while the next is confirmed', () => {
    expect(receiverWindow(768, 4_000, 26_000)).toBe(2);
  });

  it('leaves fast links bound only by client memory', () => {
    expect(receiverWindow(768, 25_000_000, 30_000)).toBe(768);
  });

  it('uses the memory window before the link is measured, and never exceeds it', () => {
    expect(receiverWindow(768, 0, 26_000)).toBe(768);
    expect(receiverWindow(1, 64_000, 26_000)).toBe(1);
  });

  it('sizes window with RTT via Little’s law (spec §6.1)', () => {
    // 50 kB/s, 46 kB avg, rtt 2 s -> ceil(50000 * 3 / 46000) = 4
    expect(receiverWindow(768, 50_000, 46_000, 2)).toBe(4);
    // rtt 0 produces the same result as default
    expect(receiverWindow(768, 50_000, 46_000, 0)).toBe(2);
    expect(receiverWindow(768, 50_000, 46_000)).toBe(2);
    // Still capped by memory when Little's law exceeds it
    expect(receiverWindow(3, 50_000, 46_000, 2)).toBe(3);
    // Unmeasured links return memory even if rtt is provided
    expect(receiverWindow(10, 0, 46_000, 2)).toBe(10);
  });
});

describe('byte window (max_kib)', () => {
  it('reserves one delivery as large as the largest yet and the rest at the average', () => {
    const mib12 = 12 * 1024 * 1024;
    expect(byteRoom(mib12, 64 * 1024, 64 * 1024)).toBe(192);
    // 2.5 MB left with 33 KB deliveries and one of 250 KB seen: about 70 more fit, not 10.
    expect(byteRoom(2_500_000, 250_000, 33_000)).toBe(69);
    expect(byteRoom(mib12, 0, 0)).toBe((12 * 1024) / KIB_PER_BRUSH);
  });

  it('has no room when not even the largest fits', () => {
    expect(byteRoom(-5, 1000, 1000)).toBe(0);
    expect(byteRoom(249_999, 250_000, 33_000)).toBe(0);
    expect(byteRoom(250_000, 250_000, 33_000)).toBe(1);
  });

  it('counts the wire and the unused part of the last grant as still coming', () => {
    expect(coming(20, 5)).toBe(WIRE_FLOWS + 15);
    expect(coming(3, 8)).toBe(WIRE_FLOWS);
  });
});

describe('synthesis horizon (ADR-08)', () => {
  it('drains jobs according to pool size, job duration, and RTT', () => {
    expect(synthesisHorizon(4, 6, 0)).toBe(67);
    expect(synthesisHorizon(2, 25, 0.08)).toBe(17);
    expect(synthesisHorizon(4, 0, 0)).toBe(Infinity);
  });

  it('binds receiverWindow when synthesis is slower than link rate', () => {
    expect(receiverWindow(768, 25_000_000, 30_000, 0, { parallel: 2, jobMs: 25 })).toBe(8);
  });

  it('leaves the link binding when the link is slower than synthesis', () => {
    expect(receiverWindow(768, 64_000, 26_000, 0, { parallel: 4, jobMs: 5 })).toBe(3);
  });

  it('never drops below CREDIT_MIN even when synthesis is very slow', () => {
    expect(receiverWindow(768, 25_000_000, 30_000, 0, { parallel: 1, jobMs: 1000 })).toBe(2);
  });

  it('never exceeds available client memory', () => {
    expect(receiverWindow(5, 25_000_000, 30_000, 0, { parallel: 8, jobMs: 1 })).toBe(5);
  });
});
