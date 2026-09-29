import { SEED_STRATUM } from '@/shared/config/constants';
import { parentBrushId, splitBrushId } from '@/shared/proto/brush';
import type { DeliveryRecord } from '../store';
import { linkParent, parentFor } from './brush-graph';
import { rebuildPlanes } from './rebuild-planes';
import { enqueue } from './synth-dispatch';
import { buildRequest, withParent } from './synth-request';
import type { SinkState } from './state';

/** Hand the held delivery to the workers, or park it until its parent's planes exist. */
export function startSynthesis(s: SinkState, rec: DeliveryRecord): void {
  const req = buildRequest(s, rec, rec.qY ?? 0, rec.qC ?? 0);
  const { stratum, bx, by } = splitBrushId(rec.brushId);
  const parent = parentFor(s.book, s.top, stratum, bx, by, rec.edition, rec.epoch);
  if (parent) linkParent(s.book, rec.delivery, parent.delivery);
  if (parent?.planes) withParent(s, req, parent, bx, by);
  if (stratum < SEED_STRATUM && !parent?.planes) {
    s.pending.set(rec.delivery, { req, parentId: parentBrushId(stratum, bx, by, s.top), edition: rec.edition });
    if (parent) rebuildPlanes(s, parent); // held but stripped of its planes: they come back from its bands
    return;
  }
  enqueue(s, req, rec.brushId, rec.epoch);
}
