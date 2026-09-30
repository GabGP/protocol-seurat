import { describe, expect, it } from 'vitest';
import type { BrushGeom } from '@/entities/delivery';
import { Drawable } from '../drawable';

const brush = (delivery: number, bmp: ImageBitmap | null): BrushGeom => (
  { delivery, stratum: 0, bx: delivery, by: 0, x: 0, y: 0, w: 256, h: 256, bmp, image: delivery, pw: 256, ph: 256 }
);
const bitmap = {} as ImageBitmap;

describe('Drawable (Canvas2D keeps and draws bitmaps)', () => {
  it('passes every brush that holds its bitmap through, untouched', () => {
    const list = [brush(1, bitmap), brush(2, bitmap)];
    const needed: number[] = [];
    expect(new Drawable().of(list, (b) => needed.push(b.delivery))).toEqual(list);
    expect(needed).toEqual([]);
  });

  it('drops the brushes a WebGL context had released and asks for their pixels', () => {
    const list = [brush(1, bitmap), brush(2, null), brush(3, null)];
    const needed: number[] = [];
    expect(new Drawable().of(list, (b) => needed.push(b.delivery)).map((b) => b.delivery)).toEqual([1]);
    expect(needed).toEqual([2, 3]);
  });

  it('filters once per list identity (the cullers downstream memoize on it)', () => {
    const d = new Drawable();
    const list = [brush(1, bitmap), brush(2, null)];
    const needed: number[] = [];
    const first = d.of(list, (b) => needed.push(b.delivery));
    expect(d.of(list, (b) => needed.push(b.delivery))).toBe(first);
    expect(needed).toEqual([2]);
    expect(d.of([...list], () => undefined)).not.toBe(first);
  });
});
