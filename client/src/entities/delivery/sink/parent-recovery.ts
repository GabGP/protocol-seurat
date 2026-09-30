import { brushKey, parentBrushId, splitBrushId } from '@/shared/proto/brush';
import { STALE_PARENT, type SynthRequest, type SynthResult } from '@/workers/protocol';
import type { InflightSynth, SinkState } from './state';
import { brushBands, linkParent, parentFor } from './brush-graph';
import { settlePlanes } from './plane-keep';
import { rebuildPlanes } from './rebuild-planes';
import { failSynthesis } from './removal';
import { endRestore } from './restore-queue';
import { flushPending } from './synth-flush';
import { enqueue } from './synth-dispatch';
import { withParent } from './synth-request';

/** A rebuild failed: only the children waiting on those planes fail (the brush itself stays, its image is fine). */
export function failRebuild(s: SinkState, delivery: number): void {
  s.rebuilding.delete(delivery);
  const rec = s.book.byDelivery.get(delivery);
  if (!rec) return;
  const waiting = [...s.pending].filter(([, w]) => w.parentId === rec.brushId && w.edition === rec.edition);
  for (const [d, item] of waiting) {
    if (!s.pending.has(d)) continue; // an earlier failure already took this subtree
    if (item.req.planesOnly) {
      s.pending.delete(d);
      failRebuild(s, d);
    } else if (item.req.restore) {
      s.pending.delete(d);
      endRestore(s, d);
    } else failSynthesis(s, d);
  }
}

/**
 * The assigned worker had evicted the parent: re-attach bytes and requeue. A parent that lost its
 * planes is rebuilt first and the request waits for it (`flushPending` sends it).
 */
export function retryWithBytes(s: SinkState, req: SynthRequest, brushId: bigint, epoch: number): void {
  const rec = s.book.byDelivery.get(req.delivery);
  if (!rec) return;
  const { stratum, bx, by } = splitBrushId(brushId);
  const parent = parentFor(s.book, s.top, stratum, bx, by, req.edition, rec.epoch);
  if (!parent) {
    if (req.planesOnly) failRebuild(s, req.delivery);
    else if (req.restore) endRestore(s, req.delivery);
    else failSynthesis(s, req.delivery);
    return;
  }
  linkParent(s.book, req.delivery, parent.delivery);
  req.parentRef = undefined;
  req.bands = brushBands(s.book, rec); // the first post transferred (detached) the old copies
  if (!parent.planes) {
    s.pending.set(req.delivery, { req, parentId: parentBrushId(stratum, bx, by, s.top), edition: req.edition, bytes: true });
    rebuildPlanes(s, parent);
    return;
  }
  withParent(s, req, parent, bx, by);
  enqueue(s, req, brushId, epoch, false);
}

/** A planes-only answer: the planes and nothing else, then whatever waited for them goes. */
export function onRebuilt(s: SinkState, out: SynthResult, index: number, ctx: InflightSynth): void {
  if (!out.ok || !out.planes) {
    s.activeSynthesis.delete(out.delivery);
    if (out.error === STALE_PARENT) retryWithBytes(s, ctx.req, ctx.brushId, ctx.epoch);
    else failRebuild(s, out.delivery);
    return;
  }
  s.rebuilding.delete(out.delivery);
  s.activeSynthesis.delete(out.delivery);
  const rec = s.book.byDelivery.get(out.delivery);
  if (!rec) return;
  rec.planes = out.planes;
  s.origin.set(brushKey(rec.brushId, rec.edition), index);
  s.revision++; // the paint caches hold the planes they read
  flushPending(s);
  settlePlanes(s, rec); // the children that waited took their copy
}
