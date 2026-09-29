import { describe, expect, it } from 'vitest';
import { addGpuBytes, gpuBytes } from '../gpu-meter';

describe('gpu meter', () => {
  it('sums what atlases allocate and free, and never goes below zero', () => {
    const start = gpuBytes();
    addGpuBytes(1000);
    addGpuBytes(-400);
    expect(gpuBytes()).toBe(start + 600);
    addGpuBytes(-1e15);
    expect(gpuBytes()).toBe(0);
  });
});
