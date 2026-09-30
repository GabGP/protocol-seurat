import { PLANES_HELD_MAX } from '@/shared/config/memory';
import type { DeliveryRecord } from '../store';
import { isWaitedOn, keepsPlanes, rootStratum } from './plane-keep';
import { distTiles } from './synth-request';
import type { SinkState } from './state';

/**
 * A brush gives its planes back unless a child of it can be planned soon (`keepsPlanes`): the
 * current cone above the focus, the roots, a pixel readout. What is held above `PLANES_HELD_MAX`
 * (a very wide view) goes farthest from the view first. A child that arrives later has them
 * rebuilt from the brush's bands one level up (`rebuildPlanes`).
 */
export function dropColdPlanes(s: SinkState): void {
  if (!s.view) return;
  const root = rootStratum(s);
  const spare: Array<{ rec: DeliveryRecord; dist: number }> = [];
  let dropped = false;
  for (const rec of s.book.byDelivery.values()) {
    if (!rec.planes) continue;
    if (!keepsPlanes(s, rec)) {
      rec.planes = null;
      dropped = true;
    } else if (rec.stratum < root && !s.readout.includes(rec.delivery) && !isWaitedOn(s, rec)) {
      spare.push({ rec, dist: distTiles(s, rec.brushId) });
    }
  }
  spare.sort((a, b) => a.dist - b.dist);
  for (const { rec } of spare.slice(PLANES_HELD_MAX)) {
    rec.planes = null;
    dropped = true;
  }
  if (dropped) s.revision++; // the paint caches hold the planes they read
}
