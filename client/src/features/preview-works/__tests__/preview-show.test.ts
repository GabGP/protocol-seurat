import { describe, expect, it } from 'vitest';
import { PreviewFinisher } from '../model/preview-finisher';
import { newLevel, PreviewLevels, touch, type Level } from '../model/preview-levels';
import { showLevel } from '../model/preview-show';

const W = 40;
const H = 12;
const level = (): Level => newLevel({ planes: [0, 1, 2].map(() => new Int16Array(W * H)), width: W, height: H });
const finisher = new PreviewFinisher(() => null);

/** Writes `v` into `level`'s luma over `x0..x0+w`, all rows, and marks it changed. */
function paint(l: Level, x0: number, w: number, v: number): void {
  for (let y = 0; y < H; y++) l.planes[0]?.fill(v, y * W + x0, y * W + x0 + w);
  touch(l, { x: x0, y: 0, w, h: H });
}

describe('showLevel', () => {
  it('patches only what changed, as a whole finish would show it', async () => {
    const levels = new PreviewLevels();
    const l = level();
    const first = await showLevel(levels, l, 10, finisher);
    const pixels = first.rgba;
    expect(first).toMatchObject({ width: 10, height: 3 });
    paint(l, 20, 8, 200);
    const second = await showLevel(levels, l, 10, finisher);
    expect(second).not.toBe(first);
    expect(second.rgba).toBe(pixels); // patched in place, no new image
    const whole = await showLevel(new PreviewLevels(), { ...l, dirty: { x: 0, y: 0, w: W, h: H } }, 10, finisher);
    expect(Array.from(second.rgba)).toEqual(Array.from(whole.rgba));
  });

  it('keeps the image when nothing changed, and finishes all of it for a new level or size', async () => {
    const levels = new PreviewLevels();
    const l = level();
    const first = await showLevel(levels, l, 10, finisher);
    expect(await showLevel(levels, l, 10, finisher)).toBe(first);
    const wider = await showLevel(levels, l, 20, finisher);
    expect(wider).toMatchObject({ width: 20, height: 6 });
    expect(wider.rgba).not.toBe(first.rgba);
    const other = level();
    other.dirty = null;
    expect((await showLevel(levels, other, 20, finisher)).rgba).not.toBe(wider.rgba);
  });
});

describe('touch', () => {
  it('grows the changed part to cover each mark, clipped to the level', () => {
    const l = level();
    l.dirty = null;
    touch(l, { x: 4, y: 2, w: 3, h: 3 });
    touch(l, { x: 30, y: 8, w: 20, h: 20 });
    expect(l.dirty).toEqual({ x: 4, y: 2, w: 36, h: 10 });
  });
});
