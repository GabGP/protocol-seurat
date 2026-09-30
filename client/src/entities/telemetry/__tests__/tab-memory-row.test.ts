import { describe, expect, it } from 'vitest';
import { tabMemoryRows, TAB_KEY, TAB_SPLIT_KEY } from '../tab-memory-row';
import { telemetrySections } from '../sections';
import { PENDING } from '../types';
import { fmtBytes } from '@/shared/lib/format-units';

const MIB = 2 ** 20;

describe('tab memory rows', () => {
  it('shows nothing when the browser cannot measure', () => {
    expect(tabMemoryRows(undefined)).toEqual([]);
  });

  it('holds both rows in place with placeholders until the first measurement arrives', () => {
    expect(tabMemoryRows(null)).toEqual([
      { k: TAB_KEY, v: PENDING },
      { k: TAB_SPLIT_KEY, v: PENDING },
    ]);
  });

  it('shows the measured total, then the page and worker share', () => {
    const rows = tabMemoryRows({ total: 142 * MIB, page: 90 * MIB, workers: 40 * MIB });
    expect(rows).toEqual([
      { k: TAB_KEY, v: fmtBytes(142 * MIB) },
      { k: TAB_SPLIT_KEY, v: `${fmtBytes(90 * MIB)} · ${fmtBytes(40 * MIB)}` },
    ]);
  });

  it('leads the memory section, above the estimate, with or without an image open', () => {
    const base = { now: 0, transport: null, link: null, image: null, sink: null, concession: null };
    const memory = (tabMemory?: null) =>
      telemetrySections({ ...base, tabMemory }).find((s) => s.title === 'Memory on this device')?.rows.map((r) => r.k) ?? [];
    expect(memory(null)[0]).toBe(TAB_KEY);
    expect(memory()).not.toContain(TAB_KEY);
  });
});
