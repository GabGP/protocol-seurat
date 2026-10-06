import { BYTES_PER_KIB, SEED_STRATUM, toKib } from '@/shared/config/constants';
import { brushKey, makeBrushId, parentBrushId, splitBrushId } from '@/shared/proto/brush';
import { heldBrushes, holdsBrush, ownedBytes, type DeliveryRecord } from '../store';
import { relieve } from './eviction';
import type { SinkState } from './state';

/** The concession and epoch checks of spec 5.4 (a server fault when they fail), or null. */
function grantFault(s: SinkState, rec: DeliveryRecord): [string, string] | null {
  const g = s.grant;
  if (g === null) return null;
  if (rec.stratum < g.minStratum) {
    return ['concession', `the concession allows stratum ${g.minStratum} at best, a server fault`];
  }
  const last = s.lastScrape;
  if (last !== null && rec.delivery > last.through && rec.epoch < last.epoch) {
    return ['epoch', `epoch ${rec.epoch} is older than the scrape of epoch ${last.epoch}, a server fault`];
  }
  return null;
}

/** Spec 5.4: why this arrival cannot be held (the check, and what it found), or null. */
export function refuse(s: SinkState, rec: DeliveryRecord, bytes: number): [string, string] | null {
  const fault = grantFault(s, rec);
  if (fault !== null) return fault;
  const { book } = s;
  const fits = (): boolean => (heldBrushes(book) < s.limits.maxBrushes() || holdsBrush(book, rec.brushId, rec.edition))
    && ownedBytes(book) + bytes <= s.limits.maxKiB() * BYTES_PER_KIB;
  if (!fits()) relieve(s); // at capacity the pressure trigger holds: make room first (spec 5.2.3)
  if (!fits()) {
    return ['capacity', `${heldBrushes(book)} of ${s.limits.maxBrushes()} brushes and `
      + `${toKib(ownedBytes(book))} of ${s.limits.maxKiB()} KiB held, a server fault`];
  }
  if (s.grant === null || rec.stratum >= SEED_STRATUM) return null;
  const { bx, by } = splitBrushId(rec.brushId);
  const seed = makeBrushId(SEED_STRATUM, 0, 0);
  const parentId = parentBrushId(rec.stratum, bx, by, s.top);
  let held = 0;
  for (const p of book.byDelivery.values()) {
    if (p.brushId === parentId && p.edition === rec.edition) held = parentId === seed ? 4 : Math.max(held, p.through);
  }
  if (held >= rec.through || !s.settlement.settledBelow(rec.delivery, (n) => book.byDelivery.has(n))) {
    return null; // parent held with >= b1 bands, or still on its way: the child waits for it
  }
  return ['parent', s.departures.parentMissing(brushKey(parentId, rec.edition), held, rec.through, performance.now())];
}
