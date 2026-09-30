import { ReleaseReason } from '@/shared/config/constants';
import { brushKey } from '@/shared/proto/brush';
import type { Departure } from '../departures';
import { heldBrushes } from '../store';
import { descendants, unlink } from './brush-graph';
import { forgetOrigin } from './plane-origin';
import { pump } from './synth-dispatch';
import { release } from './release';
import { restoreNewest } from './superseded';
import type { SinkState } from './state';

/** The book size and time a departure is logged with (a refusal reads them back). */
interface Snapshot {
  held: number;
  max: number;
  at: number;
}

function snapshot(s: SinkState): Snapshot {
  return { held: heldBrushes(s.book), max: s.limits.maxBrushes(), at: performance.now() };
}

/** The one way a delivery leaves the book: logged, settled, its image and synthesis state dropped, unlinked. */
function removeDelivery(s: SinkState, n: number, why: Departure, snap: Snapshot): void {
  const rec = s.book.byDelivery.get(n);
  if (rec) {
    const key = brushKey(rec.brushId, rec.edition);
    s.departures.note(key, why, n, snap.at, snap.held, snap.max);
    forgetOrigin(s, rec);
    rec.rgba?.close();
    rec.planes = null;
    rec.bands = [];
    if (why === 'evicted') s.evictions.evict(rec.bytes);
  }
  s.settlement.mark(n); // it was held, so it arrived: settled whatever happens to it now
  s.pending.delete(n);
  s.rebuilding.delete(n);
  s.wanted.delete(n);
  s.restoring.delete(n);
  s.inflight.delete(n);
  s.book.byDelivery.delete(n);
  s.book.inFlight.delete(n);
  s.activeSynthesis.delete(n);
  unlink(s.book, n);
}

/** Drop a delivery and every child hung on it; `reason` other than 0 also sends the SOLTAR. */
export function removeSubtree(s: SinkState, root: number, reason: number, why: Departure): number[] {
  const all = [root, ...descendants(s.book, root)];
  const removed = new Set(all);
  s.book.pendingReceipt = s.book.pendingReceipt.filter((n) => !removed.has(n));
  const snap = snapshot(s);
  const gone = all.flatMap((n) => s.book.byDelivery.get(n) ?? []);
  for (const n of all) removeDelivery(s, n, why, snap);
  if (reason !== 0) release(s, all, reason);
  restoreNewest(s, gone); // an older delivery of a brush may be all that is left of it
  s.revision++;
  pump(s); // prune heap jobs whose delivery just died, refill freed workers
  return all;
}

export function failSynthesis(s: SinkState, delivery: number): void {
  if (s.failed.has(delivery)) return;
  const rec = s.book.byDelivery.get(delivery);
  s.failed.add(delivery);
  if (!rec) return;
  const removed = removeSubtree(s, delivery, 0, 'failed synthesis');
  release(s, removed, ReleaseReason.DECODE_FAILED);
}

/** Spec 7.3: the same brush of a newer edition is on screen, so the older edition's deliveries go (SOLTAR 7). */
export function replaceOlderEditions(s: SinkState, rec: { brushId: bigint; edition: number }): void {
  const old = [...s.book.byDelivery.values()].filter((r) => r.brushId === rec.brushId && r.edition < rec.edition);
  for (const r of old) removeDelivery(s, r.delivery, 'replaced', snapshot(s));
  if (old.length > 0) {
    s.revision++;
    release(s, old.map((r) => r.delivery), ReleaseReason.REPLACED);
  }
}
