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

/** The cone's core (spec 4.1 núcleo): a brush at the focus stratum or coarser that overlaps what is on screen now. */
export function inCore(view: EvictView | null, brushId: bigint): boolean {
  if (!view) return false;
  const { stratum, x0, y0, side } = brushRect(brushId);
  return stratum >= view.focus
    && x0 < view.x1 && x0 + side > view.x0
    && y0 < view.y1 && y0 + side > view.y0;
}

/** Periphery rings of the cone (spec 2.3): F_j is the view scaled ×2^j around its centre, j ≤ 2. */
const CONE_RINGS = 2;

/**
 * The cone the server may still be painting (spec 2.3): a brush at stratum focus + j overlapping
 * F_j (rings capped at 2, so coarser ancestors use F_2). Its children can be on the wire, so
 * evicting it would get them refused on arrival (spec 5.4) and sent for nothing.
 */
export function inCone(view: EvictView | null, brushId: bigint): boolean {
  if (!view) return false;
  const { stratum, x0, y0, side } = brushRect(brushId);
  if (stratum < view.focus) return false;
  const scale = 2 ** Math.min(CONE_RINGS, stratum - view.focus);
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const hw = ((view.x1 - view.x0) / 2) * scale;
  const hh = ((view.y1 - view.y0) / 2) * scale;
  return x0 < cx + hw && x0 + side > cx - hw && y0 < cy + hh && y0 + side > cy - hh;
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
 * sketch (stratum ≥ `sketch`), never the core of the current view (`inCore`: focus and its
 * ancestors), and never a cone in `painted` (`inCone`), the cones the server may still be
 * painting (see `PaintedCones`): their children may be on the wire. Scoring decides only the
 * order among these.
 */
export function collectCandidates(
  book: DeliveryLedger,
  core: EvictView | null,
  painted: readonly EvictView[],
  sketch: number,
): EvictCandidate[] {
  const out: EvictCandidate[] = [];
  for (const [key, recs] of ownedBrushes(book)) {
    const first = recs[0]!;
    const { stratum, x0, y0, side } = brushRect(first.brushId);
    if (stratum >= sketch || inCore(core, first.brushId) || painted.some((v) => inCone(v, first.brushId))) continue;
    const hasKids = recs.some((r) => [...(book.childrenOf.get(r.delivery) ?? [])].some((k) => book.byDelivery.has(k)));
    if (hasKids) continue;
    out.push({ key, recs, stratum, cx: x0 + side / 2, cy: y0 + side / 2, side });
  }
  return out;
}
