import { PLANES_ROOT_STRATA } from '@/shared/config/memory';
import { inCone } from '../evict-candidate';
import type { DeliveryRecord } from '../store';
import type { SinkState } from './state';

/** The coarsest strata seed every cone (and every rebuild chain): their planes always stay. */
export function rootStratum(s: SinkState): number {
  return Math.max(0, s.top - PLANES_ROOT_STRATA + 1);
}

/** A child parked on this brush's planes (a rebuild is on its way): they must outlive that answer. */
export function isWaitedOn(s: SinkState, rec: DeliveryRecord): boolean {
  for (const w of s.pending.values()) if (w.parentId === rec.brushId && w.edition === rec.edition) return true;
  return false;
}

/**
 * A child of this brush can be planned soon: only the current cone plans them (its brushes at
 * focus + j overlap F_j, spec 2.3), and only from a brush strictly above the focus. Everything
 * else is rebuilt from bands when a child does come (`rebuildPlanes`), or read from the worker's
 * cache by reference (`origin`).
 */
export function wantsPlanes(s: SinkState, rec: DeliveryRecord): boolean {
  if (!s.view || rec.stratum >= rootStratum(s)) return true;
  return rec.stratum > s.view.focus && inCone(s.view, rec.brushId);
}

/**
 * Whether a brush holds its planes, as it lands and after every trim: while a pixel readout sits
 * on the tile (`s.readout`); else never at or below min_estrato (spec 4.1 a), and otherwise while
 * a child can be pending on them or one waits.
 */
export function keepsPlanes(s: SinkState, rec: DeliveryRecord): boolean {
  if (s.readout.includes(rec.delivery)) return true;
  if (rec.stratum <= (s.grant?.minStratum ?? 0)) return false;
  return wantsPlanes(s, rec) || isWaitedOn(s, rec);
}

/** Give back planes nobody needs any more (the paint caches hold the planes they read). */
export function settlePlanes(s: SinkState, rec: DeliveryRecord): void {
  if (!rec.planes || keepsPlanes(s, rec)) return;
  rec.planes = null;
  s.revision++;
}
