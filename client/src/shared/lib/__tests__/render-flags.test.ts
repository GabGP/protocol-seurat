import { describe, expect, it } from 'vitest';
import { parseRenderFlags } from '../render-flags';

describe('parseRenderFlags', () => {
  it('defaults to every optimization on, meter off', () => {
    expect(parseRenderFlags('')).toEqual({
      grid: true, shadow: true, dots: true, cull: true, lod: true, blurWhileMoving: false, fps: false,
    });
  });

  it('reads a comma list, case- and space-insensitive, ignoring unknown switches', () => {
    const f = parseRenderFlags('?render=NoCull, fps,nolod,blur,bogus');
    expect(f).toMatchObject({ cull: false, lod: false, fps: true, blurWhileMoving: true, grid: true });
  });
});
