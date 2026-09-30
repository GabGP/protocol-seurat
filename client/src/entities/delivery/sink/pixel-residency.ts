import { SEED_STRATUM } from '@/shared/config/constants';
import { PLANES_READOUT_KEEP } from '@/shared/config/memory';
import { brushKey } from '@/shared/proto/brush';
import { STALE_PARENT, type SynthResult } from '@/workers/protocol';
import { nextImageId } from '../store';
import { retryWithBytes } from './parent-recovery';
import { keepsPlanes, settlePlanes } from './plane-keep';
import { rebuildPlanes } from './rebuild-planes';
import { endRestore, pumpRestores } from './restore-queue';
import { bitmapOf } from './synth-bitmap';
import { flushPending } from './synth-flush';
import type { InflightSynth, SinkState } from './state';

/**
 * Where a brush's pixels live. WebGL uploads a tile once and the decoded bitmap is closed
 * (`releasePixels`): the record keeps its bands and its image identity, the GPU keeps the pixels.
 * When pixels are needed again (a new context after a loss, a switch to Canvas2D) they are decoded
 * again from the bands (`restore-queue`), locally: no receipt, no settlement, no children redone.
 */

/** The GPU holds this tile now: give the bitmap back. The seed's sketch stays (base layer, minimap source, small). */
export function releasePixels(s: SinkState, delivery: number, image: number): void {
  const rec = s.book.byDelivery.get(delivery);
  if (!rec?.rgba || rec.image !== image || rec.stratum >= SEED_STRATUM) return;
  rec.rgba.close();
  rec.rgba = null;
  s.revision++;
}

/** Planes for a readout of a released brush (the ordinary planes-only rebuild), held for the readout: a few, oldest out. */
export function wantPlanes(s: SinkState, delivery: number): void {
  const rec = s.book.byDelivery.get(delivery);
  if (!rec || s.restoring.has(delivery)) return;
  if (!s.readout.includes(delivery)) s.readout.push(delivery);
  for (const gone of s.readout.splice(0, Math.max(0, s.readout.length - PLANES_READOUT_KEEP))) {
    const old = s.book.byDelivery.get(gone);
    if (old) settlePlanes(s, old);
  }
  rebuildPlanes(s, rec);
}

/** A restore's answer: the image only. A cache miss retries with bytes; any other failure just ends it. */
export function onPixelsRestored(s: SinkState, out: SynthResult, index: number, ctx: InflightSynth): void {
  if (!out.ok || (!out.rgba && !out.bitmap)) {
    s.activeSynthesis.delete(out.delivery);
    if (out.error === STALE_PARENT) retryWithBytes(s, ctx.req, ctx.brushId, ctx.epoch);
    else endRestore(s, out.delivery);
    return;
  }
  const rec = s.book.byDelivery.get(out.delivery);
  if (rec) s.origin.set(brushKey(rec.brushId, rec.edition), index);
  bitmapOf(out)
    .then((bmp) => landRestored(s, out, bmp))
    .catch(() => {
      if (s.activeSynthesis.get(out.delivery) === out.synthesisId) endRestore(s, out.delivery);
    });
}

function landRestored(s: SinkState, out: SynthResult, bmp: ImageBitmap): void {
  if (s.activeSynthesis.get(out.delivery) !== out.synthesisId) {
    bmp.close();
    return;
  }
  s.activeSynthesis.delete(out.delivery);
  s.restoring.delete(out.delivery);
  const rec = s.book.byDelivery.get(out.delivery);
  if (!rec || rec.rgba) {
    bmp.close();
    pumpRestores(s);
    return;
  }
  rec.rgba = bmp;
  rec.image = nextImageId();
  if (!rec.planes && keepsPlanes(s, rec)) rec.planes = out.planes;
  s.revision++;
  s.repaint();
  flushPending(s);
  pumpRestores(s);
}
