import type { WorkPreview } from '@/entities/work/previews';
import type { Rect } from '@/workers/plane-shrink';
import type { DecodedPlanes } from './preview-decoder';

/** A level of the composite: each brush signed by the pieces it stands on, and what changed since it was shown. */
export interface Level extends DecodedPlanes {
  sigs: Map<string, string>;
  dirty: Rect | null;
}

/** `planes` as a level with nothing placed yet, all of it to show. */
export function newLevel(planes: DecodedPlanes): Level {
  return { ...planes, sigs: new Map(), dirty: { x: 0, y: 0, w: planes.width, h: planes.height } };
}

/** Marks `r` of `level` (clipped to it) as changed since it was last shown. */
export function touch(level: Level, r: Rect): void {
  const x0 = Math.max(0, Math.min(r.x, level.dirty?.x ?? r.x));
  const y0 = Math.max(0, Math.min(r.y, level.dirty?.y ?? r.y));
  const x1 = Math.min(level.width, Math.max(r.x + r.w, level.dirty ? level.dirty.x + level.dirty.w : 0));
  const y1 = Math.min(level.height, Math.max(r.y + r.h, level.dirty ? level.dirty.y + level.dirty.h : 0));
  level.dirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * A loan's composite, kept between its composes so each one decodes, places and shows only the
 * brushes whose pieces changed: the seed, each stratum under it (planes allocated once, not per
 * compose), and the card's image last shown with the level it was shown from.
 */
export class PreviewLevels {
  seed: Level | null = null;
  shown: { preview: WorkPreview; from: Level } | null = null;
  private readonly strata = new Map<number, Level>();

  /** Stratum `s`, `width × height`: as kept, or new (every brush to place) when it was not kept at that size. */
  stratum(s: number, width: number, height: number): Level {
    const kept = this.strata.get(s);
    if (kept && kept.width === width && kept.height === height) return kept;
    const made = newLevel({ planes: [0, 1, 2].map(() => new Int16Array(width * height)), width, height });
    this.strata.set(s, made);
    return made;
  }

  /** Drops every stratum finer than `finest`: the card no longer shows them. */
  keepDownTo(finest: number): void {
    for (const s of this.strata.keys()) if (s < finest) this.strata.delete(s);
  }

  get size(): number {
    return this.strata.size;
  }
}
