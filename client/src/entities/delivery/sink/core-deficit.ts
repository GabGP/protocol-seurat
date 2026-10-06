import { BAND_COUNTS, SEED_STRATUM, TILE } from '@/shared/config/constants';
import { clamp } from '@/shared/lib/clamp';
import { makeBrushId } from '@/shared/proto/brush';
import type { SinkState } from './state';

const FULL_BANDS = BAND_COUNTS.length;

/**
 * The bands the server wants at the focus stratum (ConePlanner): fewer as the zoom nears the next
 * stratum. The focus' ancestors want them all.
 */
export function focusBands(ideal: number, focus: number): number {
  const idealStratum = clamp(Math.floor(ideal), 0, SEED_STRATUM);
  const phi = ideal <= 0 || idealStratum === SEED_STRATUM ? 0 : ideal - idealStratum;
  return focus === idealStratum ? FULL_BANDS - Math.floor(FULL_BANDS * phi) : FULL_BANDS;
}

/**
 * Core brushes (spec 4.1 núcleo: the view's tiles at the focus stratum and every coarser one,
 * clipped to the work like the server's tiling) the book lacks or holds with fewer bands than the
 * plan wants. The server paints the core first, so only while some of it is owed is room made
 * inside the current cone.
 */
export function coreMissing(s: SinkState): number {
  const v = s.view;
  if (!v) return 0;
  const { w, h } = s.size;
  const x0 = Math.max(0, v.x0);
  const y0 = Math.max(0, v.y0);
  const x1 = Math.min(w, v.x1);
  const y1 = Math.min(h, v.y1);
  if (x1 <= x0 || y1 <= y0) return 0;
  const held = new Map<bigint, number>();
  for (const r of s.book.byDelivery.values()) held.set(r.brushId, Math.max(held.get(r.brushId) ?? 0, r.through));
  let missing = 0;
  for (let stratum = v.focus; stratum < s.top; stratum++) {
    const want = stratum === v.focus ? s.focusBands : FULL_BANDS;
    const f = TILE * 2 ** stratum;
    const bx1 = Math.min(Math.floor((x1 - 1) / f), Math.floor((w - 1) / f));
    const by1 = Math.min(Math.floor((y1 - 1) / f), Math.floor((h - 1) / f));
    for (let by = Math.floor(y0 / f); by <= by1; by++) {
      for (let bx = Math.floor(x0 / f); bx <= bx1; bx++) {
        if ((held.get(makeBrushId(stratum, bx, by)) ?? 0) < want) missing++;
      }
    }
  }
  return missing;
}
