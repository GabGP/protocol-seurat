import { TILE } from '@/shared/config/constants';
import { brushKey, splitBrushId } from '@/shared/proto/brush';
import type { DeliveryLedger, DeliveryRecord } from './store';

/** The view the last MIRADA described, in image px, and its focus stratum. */
export interface EvictView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  focus: number;
}

/** A whole brush (all deliveries of one brush + edition) that §5.2.3 allows to be evicted. */
export interface EvictCandidate {
  key: string;
  recs: DeliveryRecord[];
  stratum: number;
  /** Brush centre and side, image px. */
  cx: number;
  cy: number;
  side: number;
}

/** Brush square in image px. */
export function brushRect(brushId: bigint): { stratum: number; x0: number; y0: number; side: number } {
  const { stratum, bx, by } = splitBrushId(brushId);
  const side = TILE * 2 ** stratum;
  return { stratum, x0: bx * side, y0: by * side, side };
}

/** The cone's core: a brush at the focus stratum or coarser that overlaps what is on screen now. */
export function inCore(view: EvictView | null, brushId: bigint): boolean {
  if (!view) return false;
  const { stratum, x0, y0, side } = brushRect(brushId);
  return stratum >= view.focus
    && x0 < view.x1 && x0 + side > view.x0
    && y0 < view.y1 && y0 + side > view.y0;
}

/** Owned deliveries grouped per brush + edition. */
export function ownedBrushes(book: DeliveryLedger): Map<string, DeliveryRecord[]> {
  const brushes = new Map<string, DeliveryRecord[]>();
  for (const r of book.byDelivery.values()) {
    const k = brushKey(r.brushId, r.edition);
    const recs = brushes.get(k);
    if (recs) recs.push(r);
    else brushes.set(k, [r]);
  }
  return brushes;
}

/**
 * The fixed §5.2.3 filter, independent of scoring: leaves only (no owned children), never the
 * sketch (stratum ≥ `sketch`), never the core. Scoring decides only the order among these.
 */
export function collectCandidates(
  book: DeliveryLedger,
  view: EvictView | null,
  sketch: number,
): EvictCandidate[] {
  const out: EvictCandidate[] = [];
  for (const [key, recs] of ownedBrushes(book)) {
    const first = recs[0]!;
    const { stratum, x0, y0, side } = brushRect(first.brushId);
    if (stratum >= sketch || inCore(view, first.brushId)) continue;
    const hasKids = recs.some((r) => [...(book.childrenOf.get(r.delivery) ?? [])].some((k) => book.byDelivery.has(k)));
    if (hasKids) continue;
    out.push({ key, recs, stratum, cx: x0 + side / 2, cy: y0 + side / 2, side });
  }
  return out;
}
