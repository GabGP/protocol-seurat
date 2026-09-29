import { SEED_STRATUM, TILE } from '@/shared/config/constants';
import { splitBrushId } from '@/shared/proto/brush';

/** The whole-image sketch: never culled, always the base layer (it also fills tile seams). */
export const SKETCH_STRATUM = SEED_STRATUM;

export interface BrushGeom {
  delivery: number;
  stratum: number;
  bx: number;
  by: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bmp: ImageBitmap;
  /** Decoded Y/Co/Cg planes (bmp-sized), for exact pixel readout without a GPU readback. */
  planes?: ArrayBuffer[] | null;
}

interface Painted {
  delivery: number;
  brushId: bigint;
  rgba: ImageBitmap | null;
  planes?: ArrayBuffer[] | null;
}

/**
 * Drawable brushes in image space, coarse → fine (paint order), one per brush: the newest synthesized
 * delivery, which decodes the bands of every delivery of that brush and is redone on its newest
 * parent. An older one keeps the image of its own synthesis and would cover it wherever it drew later.
 */
export function collectBrushes(records: Iterable<Painted>, iw: number, ih: number): BrushGeom[] {
  const newest = new Map<bigint, Painted>();
  for (const rec of records) {
    const held = newest.get(rec.brushId);
    if (rec.rgba && (!held || rec.delivery > held.delivery)) newest.set(rec.brushId, rec);
  }
  const out: BrushGeom[] = [];
  for (const rec of newest.values()) {
    if (!rec.rgba) continue;
    const { stratum, bx, by } = splitBrushId(rec.brushId);
    if (stratum === SKETCH_STRATUM) {
      out.push({ delivery: rec.delivery, stratum, bx: 0, by: 0, x: 0, y: 0, w: iw, h: ih, bmp: rec.rgba, planes: rec.planes });
    } else {
      const size = TILE * 2 ** stratum;
      out.push({ delivery: rec.delivery, stratum, bx, by, x: bx * size, y: by * size, w: size, h: size, bmp: rec.rgba, planes: rec.planes });
    }
  }
  return out.sort((a, b) => b.stratum - a.stratum);
}

const key = (s: number, bx: number, by: number): number => (s * 2 ** 20 + by) * 2 ** 20 + bx;

/** Device px one texel of `b` spans at `devPerPx` device px per image px. */
function texel(b: BrushGeom, devPerPx: number): number {
  return (b.w / Math.max(1, b.bmp.width)) * devPerPx;
}

/**
 * Drops brushes that add nothing on screen:
 *  1. detail (`lod`): an ancestor already on screen at <= 1 texel per device px shows everything
 *     this finer brush could. Drawing it anyway only aliases a mip-less downsample; skipping it is
 *     what GPU mipmapping would pick. Visible (smoother, no shimmer) below ~50% on fine textures.
 *  2. coverage: all four children are drawn (or lie outside the image), and brushes are opaque:
 *     identical pixels except antialiased seams, which the sketch underneath fills.
 */
export function cullBrushes(list: BrushGeom[], devPerPx: number, iw: number, ih: number, lod = true): BrushGeom[] {
  const present = new Map<number, BrushGeom>();
  let sketch: BrushGeom | null = null;
  for (const b of list) {
    if (b.stratum === SKETCH_STRATUM) sketch = b;
    else present.set(key(b.stratum, b.bx, b.by), b);
  }
  const sketchSharp = lod && sketch !== null && texel(sketch, devPerPx) <= 1;
  const detailed = (b: BrushGeom): boolean => {
    if (!lod) return true;
    if (sketchSharp) return false;
    let { bx, by } = b;
    for (let s = b.stratum + 1; s < SKETCH_STRATUM; s++) {
      bx >>= 1;
      by >>= 1;
      const a = present.get(key(s, bx, by));
      if (a && texel(a, devPerPx) <= 1) return false;
    }
    return true;
  };
  const kept = new Set<number>();
  for (const b of list) if (b.stratum !== SKETCH_STRATUM && detailed(b)) kept.add(key(b.stratum, b.bx, b.by));
  const covered = (b: BrushGeom): boolean => {
    if (b.stratum === 0) return false;
    const cs = b.stratum - 1;
    const side = TILE * 2 ** cs;
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const cx = 2 * b.bx + i;
        const cy = 2 * b.by + j;
        if (cx * side >= iw || cy * side >= ih) continue;
        if (!kept.has(key(cs, cx, cy))) return false;
      }
    }
    return true;
  };
  return list.filter((b) => b.stratum === SKETCH_STRATUM
    || (kept.has(key(b.stratum, b.bx, b.by)) && !covered(b)));
}

/** Memoizes `cullBrushes` for one view: the result only changes with the list or the detail limit. */
export class BrushCuller {
  private list: BrushGeom[] | null = null;
  private limit = NaN;
  private out: BrushGeom[] = [];

  cull(list: BrushGeom[], devPerPx: number, iw: number, ih: number, enabled: boolean, lod = true): BrushGeom[] {
    if (!enabled) return list;
    const sketch = list[0]?.stratum === SKETCH_STRATUM ? list[0] : null;
    // Tiles cross the <= 1 texel/device-px line at whole strata; the sketch adds a second switch.
    const limit = lod
      ? Math.floor(Math.log2(1 / devPerPx)) * 2 + (sketch && texel(sketch, devPerPx) <= 1 ? 1 : 0)
      : Infinity;
    if (list !== this.list || limit !== this.limit) {
      this.list = list;
      this.limit = limit;
      this.out = cullBrushes(list, devPerPx, iw, ih, lod);
    }
    return this.out;
  }
}
