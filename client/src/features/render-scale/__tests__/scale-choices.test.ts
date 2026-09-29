import { describe, expect, it } from 'vitest';
import { SCALE_CHOICES, scaleStatus } from '../model/scale-choices';

describe('render scale choices', () => {
  it('offers auto, then 100%, 75% and 50%', () => {
    expect(SCALE_CHOICES.map((c) => [c.value, c.label])).toEqual([
      ['auto', 'Auto'], [1, '100%'], [0.75, '75%'], [0.5, '50%'],
    ]);
  });

  it('shows the effective scale and backing size', () => {
    expect(scaleStatus('auto', { w: 3840, h: 2160 }, 1)).toBe('auto → 50% · 1920×1080');
    expect(scaleStatus('auto', { w: 2560, h: 1440 }, 1.25)).toBe('auto → 75% · 2400×1350');
    expect(scaleStatus(1, { w: 1920, h: 1080 }, 2)).toBe('100% · 3840×2160');
    expect(scaleStatus(0.5, { w: 1920, h: 1080 }, 2)).toBe('50% · 1920×1080');
  });

  it('shows just the setting before the canvas has a size', () => {
    expect(scaleStatus('auto', null, 1)).toBe('auto');
    expect(scaleStatus(0.75, { w: 0, h: 0 }, 1)).toBe('75%');
  });
});
