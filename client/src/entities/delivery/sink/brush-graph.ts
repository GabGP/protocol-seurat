import { SEED_STRATUM } from '@/shared/config/constants';
import { parentBrushId } from '@/shared/proto/brush';
import type { DeliveryLedger, DeliveryRecord } from '../store';

/** Re-linking (sketch parent -> synthesized parent) moves the link: a stale one would keep the old parent from ever being evictable. */
export function linkParent(book: DeliveryLedger, child: number, parent: number): void {
  const old = book.parentOf.get(child);
  if (old !== undefined && old !== parent) book.childrenOf.get(old)?.delete(child);
  book.parentOf.set(child, parent);
  const children = book.childrenOf.get(parent) ?? new Set<number>();
  children.add(child);
  book.childrenOf.set(parent, children);
  const rec = book.byDelivery.get(child);
  if (rec) rec.parentDelivery = parent;
}

export function unlink(book: DeliveryLedger, delivery: number): void {
  const parent = book.parentOf.get(delivery);
  if (parent !== undefined) book.childrenOf.get(parent)?.delete(delivery);
  book.parentOf.delete(delivery);
  book.childrenOf.delete(delivery);
}

export function descendants(book: DeliveryLedger, root: number): number[] {
  const out: number[] = [];
  const visit = (n: number): void => {
    for (const child of book.childrenOf.get(n) ?? []) {
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** The best held delivery of the parent brush: newest epoch, then one with planes, then the latest number. */
export function parentFor(
  book: DeliveryLedger, top: number, stratum: number, bx: number, by: number, edition?: number, epoch?: number,
): DeliveryRecord | null {
  if (stratum >= SEED_STRATUM) return null;
  const parentId = parentBrushId(stratum, bx, by, top);
  let best: DeliveryRecord | null = null;
  for (const rec of book.byDelivery.values()) {
    if (rec.brushId !== parentId) continue;
    if (edition !== undefined && rec.edition !== edition) continue;
    if (epoch !== undefined && rec.epoch > epoch) continue;
    if (best === null) {
      best = rec;
      continue;
    }
    const diff =
      (rec.epoch - best.epoch) ||
      (Number(rec.planes != null) - Number(best.planes != null)) ||
      (rec.delivery - best.delivery);
    if (diff > 0) best = rec;
  }
  return best;
}

/** Every held delivery of the same brush and edition. */
export function sameBrush(book: DeliveryLedger, rec: DeliveryRecord): DeliveryRecord[] {
  const out: DeliveryRecord[] = [];
  for (const r of book.byDelivery.values()) {
    if (r.brushId === rec.brushId && r.edition === rec.edition) out.push(r);
  }
  return out;
}

/** Each delivery of a brush carries some of its bands (disjoint masks): synthesis decodes them all. */
export function brushBands(book: DeliveryLedger, rec: DeliveryRecord): ArrayBuffer[] {
  return sameBrush(book, rec).flatMap((r) => (r.bands ?? []).map((b) => b.slice(0)));
}
