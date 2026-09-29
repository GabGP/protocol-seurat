import { describe, expect, it } from 'vitest';
import { arrayRuns, clipView, INSTANCE_FLOATS, packTiles } from '../gl-instances';
import type { BrushGeom } from '@/entities/delivery';

function tile(stratum: number, bx: number, by: number): BrushGeom {
  const size = 256 * 2 ** stratum;
  return { delivery: 0, stratum, bx, by, x: bx * size, y: by * size, w: size, h: size, bmp: {} as ImageBitmap };
}

const row = (out: Float32Array, i: number): number[] => Array.from(out.subarray(i * INSTANCE_FLOATS, (i + 1) * INSTANCE_FLOATS));

describe('packTiles', () => {
  it('writes device rect, full uv and origin-relative image rect for an unclipped tile', () => {
    const v = clipView(10, 20, 1, 4096, 4096, 0, 0, 2000, 2000, 2);
    expect(v).not.toBeNull();
    const out = new Float32Array(INSTANCE_FLOATS * 4);
    expect(packTiles([tile(0, 1, 0)], v!, () => 7, out)).toBe(1);
    expect(row(out, 0)).toEqual([532, 40, 1044, 552, 0, 0, 1, 1, 256, 0, 512, 256, 7]);
  });

  it('trims uv and image rect to the clip, and drops tiles outside it', () => {
    const v = clipView(-100, 0, 2, 4096, 4096, 0, 0, 800, 600, 1)!; // tile 0 is half off-screen
    const out = new Float32Array(INSTANCE_FLOATS * 4);
    expect(packTiles([tile(0, 0, 0), tile(0, 20, 0)], v, () => 0, out)).toBe(1);
    const [dx0, , dx1, , u0, , u1, , ix0, , ix1] = row(out, 0);
    expect([dx0, dx1]).toEqual([0, 412]);
    expect(u0).toBeCloseTo(100 / 512);
    expect(u1).toBe(1);
    expect(v.ox).toBe(50);
    expect([ix0, ix1]).toEqual([0, 206]); // image px 50..256, relative to origin 50
  });

  it('keeps shader values small at huge offsets (200k px image at 6400%)', () => {
    const s = 64;
    const tx = -11_264_003.25;
    const v = clipView(tx, 0, s, 200_000, 200_000, 0, 0, 1600, 1000, 1)!;
    const ix = Math.floor(-tx / s / 256);
    const out = new Float32Array(INSTANCE_FLOATS * 4);
    expect(packTiles([tile(0, ix, 0)], v, () => 0, out)).toBe(1);
    for (const x of row(out, 0).slice(0, 12)) expect(Math.abs(x)).toBeLessThan(20_000);
  });

  it('gives neighbours bit-identical shared edges', () => {
    const v = clipView(0.37, 0.11, 0.731, 8192, 8192, 0, 0, 5000, 5000, 1.25)!;
    const out = new Float32Array(INSTANCE_FLOATS * 4);
    packTiles([tile(0, 3, 0), tile(0, 4, 0)], v, () => 0, out);
    expect(row(out, 0)[2]).toBe(row(out, 1)[0]);
  });

  it('clipView returns null when the image is off screen', () => {
    expect(clipView(5000, 0, 1, 100, 100, 0, 0, 800, 600, 1)).toBeNull();
  });
});

describe('arrayRuns', () => {
  it('keeps coarse tiles before fine ones across texture arrays', () => {
    const coarseInB = tile(2, 0, 0);
    const midInA = tile(1, 0, 0);
    const fineInA = tile(0, 0, 0);
    const fineInB = tile(0, 1, 0);
    const array = new Map([[coarseInB, 1], [midInA, 0], [fineInA, 0], [fineInB, 1]]);
    const runs = arrayRuns([coarseInB, midInA, fineInA, fineInB], (b) => array.get(b));
    const order = runs.flatMap((r) => r.tiles);
    expect(order.map((b) => b.stratum)).toEqual([2, 1, 0, 0]);
    expect(runs.map((r) => r.array)).toEqual([1, 0, 1]);
  });

  it('groups one stratum by array and leaves out tiles with no slot', () => {
    const a = tile(0, 0, 0);
    const b = tile(0, 1, 0);
    const c = tile(0, 2, 0);
    const array = new Map([[a, 1], [b, 0], [c, 1]]);
    const runs = arrayRuns([a, b, c, tile(0, 3, 0)], (t) => array.get(t));
    expect(runs.map((r) => [r.array, r.tiles.length])).toEqual([[0, 1], [1, 2]]);
  });
});
