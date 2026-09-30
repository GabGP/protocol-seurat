import type { BrushGeom } from '@/entities/delivery';

/**
 * The brushes Canvas2D can draw: those that still hold their bitmap (it never releases them; a
 * brush the WebGL path had released, before a fallback to this one, has none until rebuilt).
 * Filtered once per list identity so the cullers downstream can memoize; each brush without a
 * bitmap is reported so its pixels get rebuilt from the bands.
 */
export class Drawable {
  private src: readonly BrushGeom[] | null = null;
  private out: BrushGeom[] = [];

  of(src: BrushGeom[], needPixels: (b: BrushGeom) => void): BrushGeom[] {
    if (src === this.src) return this.out;
    this.src = src;
    this.out = src.filter((b) => {
      if (b.bmp) return true;
      needPixels(b);
      return false;
    });
    return this.out;
  }
}
