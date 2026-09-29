import { describe, expect, it } from 'vitest';
import { splitMeasurement } from '../memory-split';
import { tabMemory, tabMemorySupported, watchTabMemory } from '../tab-memory';

describe('memory split', () => {
  it('attributes the page and its workers, and keeps the unattributed rest in the total', () => {
    const split = splitMeasurement({
      bytes: 1000,
      breakdown: [
        { bytes: 500, attribution: [{ scope: 'Window' }] },
        { bytes: 300, attribution: [{ scope: 'DedicatedWorkerGlobalScope' }] },
        { bytes: 100, attribution: [{ scope: 'SharedWorkerGlobalScope' }] },
        { bytes: 100, attribution: [] },
      ],
    });
    expect(split).toEqual({ total: 1000, page: 500, workers: 400 });
  });
});

describe('tab memory probe', () => {
  it('is off where the browser cannot measure: nothing is polled and no value appears', () => {
    expect(tabMemorySupported()).toBe(false);
    expect(watchTabMemory()()).toBeUndefined();
    expect(tabMemory()).toBeNull();
  });
});
