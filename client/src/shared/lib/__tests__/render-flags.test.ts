import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RENDER_FLAGS, parseRenderFlags, renderFlags, resetRenderFlags, setRenderFlag, subscribeRenderFlags,
} from '../render-flags';

describe('parseRenderFlags', () => {
  it('defaults to every optimization on, meter off', () => {
    expect(parseRenderFlags('')).toEqual(DEFAULT_RENDER_FLAGS);
    expect(DEFAULT_RENDER_FLAGS).toEqual({
      grid: true, shadow: true, dots: true, cull: true, lod: true, blurWhileMoving: false, fps: false,
    });
  });

  it('reads a comma list, case- and space-insensitive, ignoring unknown switches', () => {
    const f = parseRenderFlags('?render=NoCull, fps,nolod,blur,bogus');
    expect(f).toMatchObject({ cull: false, lod: false, fps: true, blurWhileMoving: true, grid: true });
  });

  it('overrides a stored base only where the query names a switch', () => {
    const base = { ...DEFAULT_RENDER_FLAGS, fps: true, grid: false };
    expect(parseRenderFlags('?render=noshadow', base)).toMatchObject({ fps: true, grid: false, shadow: false });
  });
});

describe('live render flags', () => {
  it('mutates the shared object in place and notifies only on change', () => {
    let calls = 0;
    const off = subscribeRenderFlags(() => { calls++; });
    const same = renderFlags;
    setRenderFlag('fps', true);
    setRenderFlag('fps', true);
    expect(renderFlags).toBe(same);
    expect(renderFlags.fps).toBe(true);
    expect(calls).toBe(1);
    resetRenderFlags();
    expect(renderFlags).toEqual(DEFAULT_RENDER_FLAGS);
    off();
  });
});
