import { splitBrushId } from '@/shared/proto/brush';
import { linkParent, parentFor } from './brush-graph';
import { rebuildPlanes } from './rebuild-planes';
import { enqueue } from './synth-dispatch';
import { withParent } from './synth-request';
import type { SinkState } from './state';

/**
 * Deliveries that waited for their parent's planes go to the workers once a parent has them. A
 * held parent without planes is rebuilt from its bands; a parked rebuild whose planes came back
 * some other way is dropped.
 */
export function flushPending(s: SinkState): void {
  for (const [delivery, item] of s.pending) {
    const rec = s.book.byDelivery.get(delivery);
    if (!rec) continue;
    if (item.req.planesOnly && rec.planes) {
      s.pending.delete(delivery);
      s.rebuilding.delete(delivery);
      continue;
    }
    const { stratum, bx, by } = splitBrushId(rec.brushId);
    const parent = parentFor(s.book, s.top, stratum, bx, by, item.edition, rec.epoch);
    if (item.req.restore && (rec.rgba || !parent)) { // its image came back some other way, or nothing to rebuild it from
      s.pending.delete(delivery);
      s.restoring.delete(delivery);
      continue;
    }
    if (!parent?.planes) {
      if (parent) rebuildPlanes(s, parent);
      continue;
    }
    linkParent(s.book, delivery, parent.delivery);
    withParent(s, item.req, parent, bx, by);
    s.pending.delete(delivery);
    enqueue(s, item.req, rec.brushId, rec.epoch, !item.bytes);
  }
}
