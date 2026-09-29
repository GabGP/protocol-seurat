import { brushKey } from '@/shared/proto/brush';
import type { DeliveryRecord } from '../store';
import { sameBrush } from './brush-graph';
import { startSynthesis } from './synth-start';
import type { SinkState } from './state';

/**
 * Only the newest delivery of a brush with an image is drawn (and holds the planes children are
 * built from): the older ones keep their bands, which every synthesis of the brush decodes, but
 * give back their bitmap and planes.
 */
export function freeSuperseded(s: SinkState, rec: DeliveryRecord): void {
  const siblings = sameBrush(s.book, rec);
  let newest: DeliveryRecord | null = null;
  for (const r of siblings) if (r.rgba && (newest === null || r.delivery > newest.delivery)) newest = r;
  if (newest === null) return;
  for (const r of siblings) {
    if (r.delivery >= newest.delivery) continue;
    r.rgba?.close();
    r.rgba = null;
    r.planes = null;
  }
}

/**
 * Deliveries left the book: a brush whose newest delivery went while older ones kept only their
 * bands shows nothing now, so its newest survivor is synthesized again from those bands.
 */
export function restoreNewest(s: SinkState, gone: readonly DeliveryRecord[]): void {
  const done = new Set<string>();
  for (const g of gone) {
    const key = brushKey(g.brushId, g.edition);
    if (done.has(key)) continue;
    done.add(key);
    const siblings = sameBrush(s.book, g);
    if (siblings.length === 0 || siblings.some((r) => r.rgba || r.pending)) continue;
    let newest = siblings[0];
    for (const r of siblings) if (newest && r.delivery > newest.delivery) newest = r;
    if (!newest) continue;
    newest.pending = true;
    startSynthesis(s, newest);
  }
}
