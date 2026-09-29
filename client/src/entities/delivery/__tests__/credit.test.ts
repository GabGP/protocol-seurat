import { describe, expect, it } from 'vitest';
import { byteRoom, coming, receiverWindow } from '../credit';
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
