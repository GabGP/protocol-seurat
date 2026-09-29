import { afterEach, describe, expect, it, vi } from 'vitest';
import { backingDpr, deviceViewport } from '../device-viewport';
import { resetRenderFlags, setRenderScale } from '../render-flags';

afterEach(() => {
  resetRenderFlags();
  vi.unstubAllGlobals();
});

describe('deviceViewport', () => {
  it('reports device px: css size times device dpr times the render scale', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    setRenderScale(1);
    expect(backingDpr(1920, 1080)).toBe(2);
    expect(deviceViewport(1920, 1080)).toEqual({ vw: 3840, vh: 2160 }); // dpr 2 at scale 1 asks for finer strata
    setRenderScale(0.5);
    expect(deviceViewport(1920, 1080)).toEqual({ vw: 1920, vh: 1080 });
  });

  it('auto caps a 4K backing store', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    expect(deviceViewport(3840, 2160)).toEqual({ vw: 1920, vh: 1080 });
    expect(deviceViewport(1920, 1080)).toEqual({ vw: 1920, vh: 1080 });
  });

  it('is the css size where the device says nothing', () => {
    vi.stubGlobal('devicePixelRatio', undefined);
    setRenderScale(1);
    expect(deviceViewport(1001, 500)).toEqual({ vw: 1001, vh: 500 });
  });
});
