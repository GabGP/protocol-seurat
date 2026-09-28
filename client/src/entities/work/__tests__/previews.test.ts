import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewDpr } from '../previews';
import { PREVIEW_DPR_MAX } from '@/shared/config/layout';

describe('previewDpr', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the screen up to the cap', () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    expect(previewDpr()).toBe(1.5);
  });

  it('a 3× phone asks at the cap, not at 3×', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    expect(previewDpr()).toBe(PREVIEW_DPR_MAX);
  });
});
