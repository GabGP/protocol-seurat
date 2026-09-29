import { COLA_BUSY_MS } from '@/shared/config/constants';
import { brushKey, splitBrushId } from '@/shared/proto/brush';
import { STALE_PARENT, type SynthRequest, type SynthResult } from '@/workers/protocol';
import { brushBands, linkParent, parentFor, sameBrush } from './brush-graph';
import { flushReceipt, maybeFlushReceipt } from './receipts';
import { failSynthesis, replaceOlderEditions } from './removal';
import { enqueue, pump } from './synth-dispatch';
import { buildRequest, withParent } from './synth-request';
import type { SinkState } from './state';

/** The assigned worker had evicted the parent: re-attach bytes and requeue. */
function retryWithBytes(s: SinkState, req: SynthRequest, brushId: bigint, epoch: number): void {
  const rec = s.book.byDelivery.get(req.delivery);
  if (!rec) return;
  const { stratum, bx, by } = splitBrushId(brushId);
  const parent = parentFor(s.book, s.top, stratum, bx, by, req.edition, rec.epoch);
  if (!parent?.planes) {
    failSynthesis(s, req.delivery);
    return;
  }
  linkParent(s.book, req.delivery, parent.delivery);
  req.parentRef = undefined;
  req.bands = brushBands(s.book, rec); // the first post transferred (detached) the old copies
  withParent(s, req, parent, bx, by);
  enqueue(s, req, brushId, epoch, false);
}

/** Deliveries that waited for their parent's planes go to the workers once a parent has them. */
export function flushPending(s: SinkState): void {
  for (const [delivery, item] of s.pending) {
    const rec = s.book.byDelivery.get(delivery);
    if (!rec) continue;
    const { stratum, bx, by } = splitBrushId(rec.brushId);
    const parent = parentFor(s.book, s.top, stratum, bx, by, item.edition, rec.epoch);
    if (!parent?.planes) continue;
    linkParent(s.book, delivery, parent.delivery);
    withParent(s, item.req, parent, bx, by);
    s.pending.delete(delivery);
    enqueue(s, item.req, rec.brushId, rec.epoch);
  }
}

/**
 * The newest synthesis of a brush holds its best planes: children hung on any of its deliveries
 * (e.g. the [0,2) sketch before this retouch) are redone on it. Older deliveries of the same
 * brush don't cascade, so a retouch costs one pass per level, not one per delivery.
 */
function resynthesizeChildren(s: SinkState, parentDelivery: number): void {
  const parent = s.book.byDelivery.get(parentDelivery);
  if (!parent?.planes) return;
  const siblings = sameBrush(s.book, parent);
  if (siblings.some((x) => x.delivery > parent.delivery)) return;
  const children = siblings.flatMap((x) => [...(s.book.childrenOf.get(x.delivery) ?? [])]);
  for (const childId of children) {
    const child = s.book.byDelivery.get(childId);
    if (!child?.bands || child.epoch < parent.epoch || s.pending.has(childId)) continue; // flushPending sends those
    if (sameBrush(s.book, child).some((x) => x.delivery > child.delivery)) continue; // the newer one decodes these bands too
    const { bx, by } = splitBrushId(child.brushId);
    const req = buildRequest(s, child, child.qY ?? 0, child.qC ?? 0);
    withParent(s, req, parent, bx, by);
    child.pending = true;
    enqueue(s, req, child.brushId, child.epoch);
  }
}

/** A synthesized image landed: show it, queue its receipt, redo what hangs on it. */
function land(s: SinkState, out: SynthResult, bmp: ImageBitmap): void {
  if (s.activeSynthesis.get(out.delivery) !== out.synthesisId) {
    bmp.close();
    return;
  }
  const rec = s.book.byDelivery.get(out.delivery);
  if (!rec) {
    bmp.close();
    return;
  }
  rec.rgba?.close(); // a resynthesis keeps showing the old image until this one lands
  rec.rgba = bmp;
  rec.planes = out.planes;
  s.revision++;
  rec.pending = false;
  if (!rec.receiptQueued && !rec.receiptSent) {
    rec.receiptQueued = true;
    s.book.pendingReceipt.push(out.delivery);
  }
  replaceOlderEditions(s, rec);
  s.repaint();
  resynthesizeChildren(s, out.delivery);
  flushPending(s);
  maybeFlushReceipt(s);
}

/** A worker answered: stale answers drop, a cache miss retries with bytes, a failure releases. */
export function onResult(s: SinkState, index: number, ev: MessageEvent): void {
  const out = ev.data as SynthResult;
  s.decode.answered(out.elapsedMs);
  s.pool?.complete(index);
  // The server plans nothing while the last cola_ms said we were busy (spec §6.1): tell it we caught up.
  if (s.lastQueue >= COLA_BUSY_MS && s.decode.ms < COLA_BUSY_MS) flushReceipt(s);
  pump(s);
  if (s.activeSynthesis.get(out.delivery) !== out.synthesisId) {
    out.bitmap?.close();
    return;
  }
  const ctx = s.inflight.get(out.delivery);
  s.inflight.delete(out.delivery);
  if (!out.ok || (!out.rgba && !out.bitmap)) {
    if (out.error === STALE_PARENT && ctx) retryWithBytes(s, ctx.req, ctx.brushId, ctx.epoch);
    else failSynthesis(s, out.delivery);
    return;
  }
  const rec = s.book.byDelivery.get(out.delivery);
  if (rec) s.origin.set(brushKey(rec.brushId, rec.edition), index);
  const ready = out.bitmap
    ? Promise.resolve(out.bitmap)
    : createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba ?? new ArrayBuffer(0)), out.width, out.height));
  ready
    .then((bmp) => land(s, out, bmp))
    .catch(() => {
      if (s.activeSynthesis.get(out.delivery) === out.synthesisId) failSynthesis(s, out.delivery);
    });
}
