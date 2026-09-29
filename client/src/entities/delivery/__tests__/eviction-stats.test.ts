import { describe, expect, it } from 'vitest';
import { EvictionStats } from '../eviction-stats';
import { REFETCH_SAMPLES } from '@/shared/config/eviction';

describe('EvictionStats', () => {
  it('starts empty, with no median before a refetch', () => {
    expect(new EvictionStats().view()).toEqual({
      evicted: 0, evictedBytes: 0, refetched: 0, refetchedBytes: 0, medianRefetchMs: null,
    });
  });

  it('counts evictions and refetches, and takes the median delay', () => {
    const s = new EvictionStats();
    for (let i = 0; i < 4; i++) s.evict(100);
    s.refetch(1, 40, 300);
    s.refetch(2, 40, 100);
    s.refetch(3, 40, 200);
    expect(s.view()).toEqual({
      evicted: 4, evictedBytes: 400, refetched: 3, refetchedBytes: 120, medianRefetchMs: 200,
    });
  });

  it('counts the steps of one brush arriving again as one refetch but keeps their bytes', () => {
    const s = new EvictionStats();
    s.evict(100);
    s.refetch(1, 40, 300);
    s.refetch(1, 60, 900);
    expect(s.view()).toMatchObject({ refetched: 1, refetchedBytes: 100, medianRefetchMs: 300 });
  });

  it('keeps the delay samples bounded', () => {
    const s = new EvictionStats();
    for (let i = 0; i < REFETCH_SAMPLES * 2; i++) s.refetch(i, 1, i);
    expect(s.view().refetched).toBe(REFETCH_SAMPLES * 2);
    expect(s.view().medianRefetchMs).toBeGreaterThan(REFETCH_SAMPLES); // the oldest, smallest delays left
  });
});
