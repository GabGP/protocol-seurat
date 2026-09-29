import { describe, expect, it } from 'vitest';
import { RENDER_MAX_BACKING_PX } from '@/shared/config/render';
import { autoRenderScale, backingPx, effectiveRenderScale, parseRenderScale } from '../render-scale';

describe('autoRenderScale', () => {
  it('keeps full resolution while the backing store fits 2560 x 1440', () => {
    expect(RENDER_MAX_BACKING_PX).toBe(2560 * 1440);
    expect(autoRenderScale(1920, 1080, 1)).toBe(1);
    expect(autoRenderScale(2560, 1440, 1)).toBe(1); // exactly the budget
    expect(autoRenderScale(1280, 720, 2)).toBe(1); // 2560 x 1440 backing
  });

  it('snaps down to the nearest step, so 4K asks for a coarser focus', () => {
    // 3840 x 2160: sqrt(3686400 / 8294400) = 0.667 -> 0.5.
    expect(autoRenderScale(3840, 2160, 1)).toBe(0.5);
    // 1920 x 1080 CSS at dpr 2 is the same 3840 x 2160 backing: 0.667 -> 0.5, i.e. a dpr-1 MIRADA (1920 x 1080) again.
    expect(autoRenderScale(1920, 1080, 2)).toBe(0.5);
    // 2560 x 1440 at dpr 1.25: sqrt(0.64) = 0.8 -> 0.75 (2400 x 1350 backing).
    expect(autoRenderScale(2560, 1440, 1.25)).toBe(0.75);
  });

  it('never goes below the smallest step, and ignores an empty canvas', () => {
    expect(autoRenderScale(7680, 4320, 1)).toBe(0.5);
    expect(autoRenderScale(0, 0, 2)).toBe(1);
  });

  it('4K at the chosen step is a 1920 x 1080 backing store', () => {
    const s = autoRenderScale(3840, 2160, 1);
    expect(backingPx(3840, 2160, s)).toEqual({ w: 1920, h: 1080 });
  });
});

describe('render scale settings', () => {
  it('accepts auto and the steps only, as text or number', () => {
    expect(parseRenderScale('auto')).toBe('auto');
    expect(parseRenderScale('0.5')).toBe(0.5);
    expect(parseRenderScale(0.75)).toBe(0.75);
    expect(parseRenderScale('1')).toBe(1);
    expect(parseRenderScale('0.6')).toBeNull();
    expect(parseRenderScale('')).toBeNull();
    expect(parseRenderScale(null)).toBeNull();
  });

  it('a fixed step is used as is; auto follows the size', () => {
    expect(effectiveRenderScale(0.75, 800, 600, 1)).toBe(0.75);
    expect(effectiveRenderScale('auto', 3840, 2160, 1)).toBe(0.5);
  });

  it('rounds the backing size', () => {
    expect(backingPx(1001, 501, 1.5)).toEqual({ w: 1502, h: 752 });
  });
});
