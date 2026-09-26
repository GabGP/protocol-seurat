import { describe, expect, it } from 'vitest';
import { initialView, tickView } from '../model';
import { zoomTarget } from '../index';

describe('zoom-view animation & pivot invariance', () => {
  it('keeps cursor point stationary on screen throughout entire zoom animation', () => {
    // Initial view: 1x zoom, top-left at (0, 0)
    let v = initialView();
    // Cursor at (500, 300)
    const px = 500;
    const py = 300;
    // Initial image coordinate under cursor:
    const initialIx = (px - v.tx) / v.s;
    const initialIy = (py - v.ty) / v.s;
    expect(initialIx).toBe(500);
    expect(initialIy).toBe(300);

    // Zoom in 3x
    v = zoomTarget(v, 3, px, py, 0.1, 64);
    expect(v.ts).toBe(3);

    // Animate across ticks until settled
    let ticks = 0;
    while (ticks < 200) {
      const { next, moving } = tickView(v);
      v = next;
      ticks++;

      // At EVERY single frame, the image coordinate under the cursor must stay at (px, py) on screen
      const currentSx = v.tx + initialIx * v.s;
      const currentSy = v.ty + initialIy * v.s;

      expect(currentSx).toBeCloseTo(px, 1);
      expect(currentSy).toBeCloseTo(py, 1);

      if (!moving) break;
    }

    expect(v.s).toBeCloseTo(3, 2);
    expect(v.tx + initialIx * v.s).toBeCloseTo(px, 2);
    expect(v.ty + initialIy * v.s).toBeCloseTo(py, 2);
  });

  it('anchors subsequent zoomTarget calls to current view during active animation', () => {
    let v = initialView();
    // First wheel: target 2x at (400, 400)
    v = zoomTarget(v, 2, 400, 400, 0.1, 64);
    // Advance partially
    v = tickView(v).next;
    v = tickView(v).next;
    expect(v.s).toBeGreaterThan(1);
    expect(v.s).toBeLessThan(2);

    // Second wheel while animation in flight: target 4x at (400, 400)
    v = zoomTarget(v, 4, 400, 400, 0.1, 64);
    expect(v.ts).toBe(4);

    const initialIx = (400 - 0) / 1;
    // Animate to completion
    let ticks = 0;
    while (ticks < 200) {
      const { next, moving } = tickView(v);
      v = next;
      ticks++;
      const currentSx = v.tx + initialIx * v.s;
      expect(currentSx).toBeCloseTo(400, 1);
      if (!moving) break;
    }

    expect(v.s).toBeCloseTo(4, 2);
  });
});
