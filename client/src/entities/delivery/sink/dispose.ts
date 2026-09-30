import { emptyLedger } from '../store';
import type { SinkState } from './state';

/** The sink is done: timers, workers, queues and every bitmap it still holds go. */
export function disposeSink(s: SinkState): void {
  clearTimeout(s.receiptTimer);
  clearTimeout(s.releaseTimer);
  s.pool?.dispose();
  s.pool = null;
  s.ready.clear();
  s.pending.clear();
  s.activeSynthesis.clear();
  s.inflight.clear();
  s.origin.clear();
  s.failed.clear();
  s.rebuilding.clear();
  s.wanted.clear();
  s.restoring.clear();
  for (const rec of s.book.byDelivery.values()) rec.rgba?.close();
  s.book = emptyLedger();
  s.revision++;
}
