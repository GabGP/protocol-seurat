import { SEED_STRATUM } from '@/shared/config/constants';
import { parentBrushId, splitBrushId } from '@/shared/proto/brush';
import type { DeliveryRecord } from '../store';
import { parentFor } from './brush-graph';
import { enqueue } from './synth-dispatch';
import { buildRequest, withParent } from './synth-request';
import type { SinkState } from './state';

/**
 * A held brush whose planes were dropped (a cold cone, or a grant that later allowed finer strata)
 * has a child waiting: rebuild them from its own bands, seeded by its parent's planes (rebuilt in
 * turn when they are gone too; the seed always keeps its own). The answer sets planes only: the
 * bitmap on screen, the receipt and the children's images are already right.
 */
export function rebuildPlanes(s: SinkState, rec: DeliveryRecord): void {
  if (rec.planes || rec.pending || !rec.bands?.length || s.rebuilding.has(rec.delivery) || s.restoring.has(rec.delivery)) return;
  const { stratum, bx, by } = splitBrushId(rec.brushId);
  const parent = parentFor(s.book, s.top, stratum, bx, by, rec.edition, rec.epoch);
  if (stratum < SEED_STRATUM && !parent) return;
  s.rebuilding.add(rec.delivery);
  const req = { ...buildRequest(s, rec, rec.qY ?? 0, rec.qC ?? 0), planesOnly: true, keep: true };
  if (parent?.planes) withParent(s, req, parent, bx, by);
  if (parent && !parent.planes) {
    s.pending.set(rec.delivery, { req, parentId: parentBrushId(stratum, bx, by, s.top), edition: rec.edition });
    rebuildPlanes(s, parent);
    return;
  }
  enqueue(s, req, rec.brushId, rec.epoch);
}
