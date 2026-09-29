import { describe, expect, it } from 'vitest';
import type { BrushGeom } from '@/entities/delivery';
import { currentBrushes } from '../brush-cache';
import type { ChromeCtx } from '../chrome-types';

describe('currentBrushes', () => {
  it('drops the cached brush list (and its bitmaps) once there is no sink', () => {
    const held = [{ delivery: 1 }] as unknown as BrushGeom[];
    const st = { brushCache: { tick: 3, revision: 4, brushes: held } };
    const ctx = { st, P: () => ({ sink: null, paintTick: 3, iw: 1, ih: 1 }) } as unknown as ChromeCtx;
    expect(currentBrushes(ctx)).toEqual([]);
    expect(st.brushCache.brushes).toEqual([]);
    expect(st.brushCache.revision).toBe(-1);
  });
});
