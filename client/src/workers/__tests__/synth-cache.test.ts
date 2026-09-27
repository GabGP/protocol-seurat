import { describe, expect, it } from 'vitest';
import { ParentPlaneCache, type PlaneSet } from '@/workers/synth-cache';

function planes(tag: number): PlaneSet {
  return { Y: new Int16Array([tag]), Co: new Int16Array([tag]), Cg: new Int16Array([tag]) };
}

describe('ParentPlaneCache (S3-FIFO)', () => {
  it('stores, fetches, and reports missing keys', () => {
    const c = new ParentPlaneCache(2, 4, 8);
    expect(c.fetch('a')).toBeUndefined();
    expect(c.has('a')).toBe(false);
    c.store('a', planes(1));
    expect(c.has('a')).toBe(true);
    expect(c.fetch('a')?.Y[0]).toBe(1);
  });

  it('refreshing a key updates it without growth', () => {
    const c = new ParentPlaneCache(2, 4, 8);
    c.store('a', planes(1));
    c.store('a', planes(2));
    expect(c.size).toBe(1);
    expect(c.fetch('a')?.Y[0]).toBe(2);
  });

  it('evicts cold small entries to ghost, promotes hot ones, re-admits ghosts to main', () => {
    const c = new ParentPlaneCache(1, 1, 4);
    c.store('a', planes(1)); // small=[a]
    c.store('b', planes(2)); // a cold → ghost, small=[b]
    expect(c.fetch('a')).toBeUndefined();
    expect(c.fetch('b')?.Y[0]).toBe(2); // freq 1
    c.store('c', planes(3)); // b hot → main, small=[c]
    expect(c.fetch('b')?.Y[0]).toBe(2);
    c.fetch('c');
    c.fetch('c'); // c freq 2
    c.store('d', planes(4)); // c hot → main, evicting b after second chances; small=[d]
    expect(c.fetch('b')).toBeUndefined();
    expect(c.fetch('c')?.Y[0]).toBe(3);
    c.store('a', planes(5)); // ghost re-reference → straight to main
    expect(c.fetch('a')?.Y[0]).toBe(5);
    expect(c.size).toBeLessThanOrEqual(2);
  });

  it('never exceeds small + main capacity', () => {
    const c = new ParentPlaneCache(2, 3, 8);
    for (let i = 0; i < 20; i++) c.store(`k${i}`, planes(i));
    expect(c.size).toBeLessThanOrEqual(5);
  });
});
