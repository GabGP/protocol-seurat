import { brushKey } from '@/shared/proto/brush';
import { planesKey } from '@/workers/protocol';
import type { DeliveryRecord } from '../store';
import type { SinkState } from './state';

/**
 * Planes a worker made landed on this record: name their exact content and the worker that kept
 * a copy. A brush's planes improve as its bands arrive and syntheses of it may answer out of
 * order, so children go by reference only to the copy of the very planes they were given.
 */
export function adoptPlanes(s: SinkState, rec: DeliveryRecord, planes: ArrayBuffer[] | null, synthesisId: number, worker: number): void {
  forgetOrigin(s, rec);
  rec.planes = planes;
  rec.planesKey = planesKey(brushKey(rec.brushId, rec.edition), synthesisId);
  s.origin.set(rec.planesKey, worker);
}

/** The record leaves: nothing refers to its planes by name any more. */
export function forgetOrigin(s: SinkState, rec: DeliveryRecord): void {
  if (rec.planesKey !== undefined) s.origin.delete(rec.planesKey);
}
