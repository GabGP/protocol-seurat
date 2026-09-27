import { describe, expect, it } from 'vitest';
import { drawPointillism, dotsPerSide, patternOrigin, tileDots } from '../pointillism';
import { DOT_SPACING_PX, DOT_TILE_CELLS } from '@/shared/config/render';

describe('pointillism widget', () => {
  it('does nothing when there is no fade, no zoom or no area', () => {
    let filled = 0;
    const ctx = { fillRect: () => { filled++; }, createPattern: () => { filled++; } } as unknown as CanvasRenderingContext2D;
    const view = { tx: 0, ty: 0, cx0: 0, cy0: 0, cx1: 100, cy1: 100, under: '#000' };
    drawPointillism(ctx, { ...view, s: 16, amount: 0 });
    drawPointillism(ctx, { ...view, s: 0, amount: 1 });
    drawPointillism(ctx, { ...view, s: 16, amount: 1, cx1: 0 });
    expect(filled).toBe(0);
  });

  it('always paints a pixel with several dots, about DOT_SPACING_PX apart', () => {
    expect(dotsPerSide(12)).toBeGreaterThanOrEqual(2);
    expect(dotsPerSide(0.5)).toBe(2);
    expect(dotsPerSide(64)).toBe(Math.round(64 / DOT_SPACING_PX));
  });

  it('keeps every dot inside its own cell, so no dot crosses a pixel edge', () => {
    const dots = tileDots();
    expect(dots).toHaveLength(DOT_TILE_CELLS * DOT_TILE_CELLS);
    dots.forEach((d, k) => {
      const i = k % DOT_TILE_CELLS;
      const j = Math.floor(k / DOT_TILE_CELLS);
      expect(d.r).toBeGreaterThan(0);
      expect(d.x - d.r).toBeGreaterThan(i);
      expect(d.x + d.r).toBeLessThan(i + 1);
      expect(d.y - d.r).toBeGreaterThan(j);
      expect(d.y + d.r).toBeLessThan(j + 1);
    });
  });

  it('locks the dot grid to the pixel grid even at huge-image offsets', () => {
    const s = 64;
    const cell = s / dotsPerSide(s);
    const period = DOT_TILE_CELLS * cell;
    const tx = -11_264_003.25; // ~176k px wide image at 6400%
    const o = patternOrigin(tx, period);
    expect(o).toBeGreaterThanOrEqual(0);
    expect(o).toBeLessThan(period);
    for (const px of [0, 1, 175_999]) {
      const cells = (tx + px * s - o) / cell;
      expect(Math.abs(cells - Math.round(cells))).toBeLessThan(1e-6);
    }
  });
});
