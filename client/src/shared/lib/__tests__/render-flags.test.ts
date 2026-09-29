import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RENDER_FLAGS, parseRenderFlags, renderFlags, resetRenderFlags, setRenderFlag, setRenderScale, subscribeRenderFlags,
} from '../render-flags';

describe('parseRenderFlags', () => {
  it('defaults to every optimization on, meter off', () => {
    expect(parseRenderFlags('')).toEqual(DEFAULT_RENDER_FLAGS);
    expect(DEFAULT_RENDER_FLAGS).toEqual({
      grid: true, shadow: true, dots: true, cull: true, lod: true, blurWhileMoving: false, fps: false, gpu: true, scale: 'auto',
    });
  });

  it('reads a comma list, case- and space-insensitive, ignoring unknown switches', () => {
    const f = parseRenderFlags('?render=NoCull, fps,nolod,blur,bogus,gpu');
    expect(f).toMatchObject({ cull: false, lod: false, fps: true, blurWhileMoving: true, grid: true, gpu: true });
    expect(parseRenderFlags('?render=nogpu', { ...f })).toMatchObject({ gpu: false });
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

describe('render scale flag', () => {
  afterEach(() => {
    resetRenderFlags();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reads `scale:` from ?render= next to the other switches, ignoring values that are not a step', () => {
    const base = { ...DEFAULT_RENDER_FLAGS, scale: 0.75 };
    expect(parseRenderFlags('?render=scale:0.5')).toMatchObject({ scale: 0.5, fps: false });
    expect(parseRenderFlags('?render=fps,Scale:1,nogrid')).toMatchObject({ scale: 1, fps: true, grid: false });
    expect(parseRenderFlags('?render=scale:auto', base).scale).toBe('auto');
    expect(parseRenderFlags('?render=scale:0.6', base).scale).toBe(0.75);
    expect(parseRenderFlags('?render=scale:', base).scale).toBe(0.75);
  });

  it('is set in place, notifies once per change, and reset returns to auto', () => {
    let calls = 0;
    const off = subscribeRenderFlags(() => { calls++; });
    setRenderScale(0.5);
    setRenderScale(0.5);
    expect(renderFlags.scale).toBe(0.5);
    expect(calls).toBe(1);
    resetRenderFlags();
    expect(renderFlags.scale).toBe('auto');
    off();
  });

  it('is remembered per browser, and the URL wins over the stored value', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal('location', { search: '' });
    vi.resetModules();
    const first = await import('../render-flags');
    first.setRenderScale(0.75);
    expect(JSON.parse(store.get('seurat.render') ?? '{}')).toEqual({ scale: 0.75 });
    first.setRenderScale('auto');
    expect(JSON.parse(store.get('seurat.render') ?? '{}')).toEqual({}); // the default is not stored
    first.setRenderScale(0.75);

    vi.resetModules();
    expect((await import('../render-flags')).renderFlags.scale).toBe(0.75); // a reload

    vi.stubGlobal('location', { search: '?render=scale:0.5' });
    vi.resetModules();
    expect((await import('../render-flags')).renderFlags.scale).toBe(0.5);

    store.set('seurat.render', JSON.stringify({ scale: 0.6 })); // not a step: ignored
    vi.stubGlobal('location', { search: '' });
    vi.resetModules();
    expect((await import('../render-flags')).renderFlags.scale).toBe('auto');
  });
});
