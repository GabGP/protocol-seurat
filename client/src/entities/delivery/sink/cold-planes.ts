import { SKETCH_MIN } from '@/shared/config/constants';
import { inCone } from '../evict-candidate';
import { coneViews } from './cone-views';
import type { SinkState } from './state';

/**
 * Planes seed children, and a child only comes from a cone the server may still be painting. A
 * brush outside all of them (and below the sketch strata, whose planes seed every cone) gives its
 * planes back; a child that arrives later has them rebuilt from the brush's bands (`rebuildPlanes`).
 */
export function dropColdPlanes(s: SinkState): void {
  const sketch = Math.min(SKETCH_MIN, Math.max(0, s.top - 1));
  const cones = coneViews(s);
  let dropped = false;
  for (const rec of s.book.byDelivery.values()) {
    if (!rec.planes || rec.stratum >= sketch || cones.some((v) => inCone(v, rec.brushId))) continue;
    rec.planes = null;
    dropped = true;
  }
  if (dropped) s.revision++; // the paint caches hold the planes they read
}
