import { describe, expect, it } from 'vitest';
import { Departures } from '../departures';

describe('Departures', () => {
  it('tells a parent dropped here apart from one that never came or lacks bands', () => {
    const d = new Departures();
    d.note('p:2', 'evicted', 7241, 1000, 228, 256);
    expect(d.parentMissing('p:2', 0, 1, 1001)).toBe(
      'its parent (delivery 7241) was evicted here 1 ms earlier, with 228 of 256 brushes held');
    expect(d.parentMissing('q:2', 0, 1, 1001)).toBe('its parent never arrived, a server fault');
    expect(d.parentMissing('p:2', 2, 4, 1001)).toBe('its parent holds 2 of the 4 bands needed, a server fault');
  });

  it('hands back the last departure of a brush for the refetch counter', () => {
    const d = new Departures();
    expect(d.last('p:2')).toBeUndefined();
    d.note('p:2', 'evicted', 9, 500, 10, 256);
    expect(d.last('p:2')).toEqual({ why: 'evicted', delivery: 9, at: 500, held: 10, max: 256 });
  });

  it('stays bounded, forgetting the first noted', () => {
    const d = new Departures();
    for (let i = 0; i < 2000; i++) d.note(`b${i}:1`, 'expired', i, 0, 0, 256);
    expect(d.parentMissing('b0:1', 0, 1, 0)).toContain('never arrived');
    expect(d.parentMissing('b1999:1', 0, 1, 0)).toContain('delivery 1999');
  });
});
