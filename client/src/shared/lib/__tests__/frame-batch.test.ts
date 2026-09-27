import { describe, expect, it } from 'vitest';
import { frameBatch } from '../frame-batch';

describe('frameBatch', () => {
  it('runs once per frame however many calls, and never after cancel', () => {
    const frames: Array<() => void> = [];
    let runs = 0;
    const bump = frameBatch(() => { runs++; }, (cb) => frames.push(cb));
    bump(); bump(); bump();
    expect(frames).toHaveLength(1);
    frames.shift()?.();
    expect(runs).toBe(1);
    bump();
    bump.cancel();
    frames.shift()?.();
    expect(runs).toBe(1);
  });
});
