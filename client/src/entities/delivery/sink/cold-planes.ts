import { inCone } from '../evict-candidate';
import { coneViews } from './cone-views';
import { hasChildWork, sketchStratum } from './plane-keep';
import type { SinkState } from './state';

/**
 * Planes seed children, and a child comes only from a brush strictly above the focus of a cone the
 * server may still be painting (the current view included: its planned children sit at focus + j).
 * A brush at or below every such focus, or in none of them, gives its planes back (the sketch strata
 * seed every cone and stay); a child that arrives later, after a zoom-in, has them rebuilt from the
 * brush's bands one level up (`rebuildPlanes`).
 */
export function dropColdPlanes(s: SinkState): void {
  if (!s.view) return;
  const sketch = sketchStratum(s);
  const cones = coneViews(s);
  let dropped = false;
  for (const rec of s.book.byDelivery.values()) {
    if (!rec.planes || rec.stratum >= sketch) continue;
    if (rec.stratum > s.view.focus && cones.some((v) => rec.stratum > v.focus && inCone(v, rec.brushId))) continue;
    if (hasChildWork(s, rec)) continue;
    rec.planes = null;
    dropped = true;
  }
  if (dropped) s.revision++; // the paint caches hold the planes they read
}
