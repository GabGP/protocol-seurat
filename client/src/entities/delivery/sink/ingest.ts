import { AVG_DELIVERY_KEEP, AVG_DELIVERY_NEW, MAX_EARLY_DELIVERIES, MS_PER_S, ReleaseReason } from '@/shared/config/constants';
import { REFETCH_WINDOW_MS } from '@/shared/config/eviction';
import { brushKey, parseBrushHead, sliceBands, verifyBand, type BrushHead } from '@/shared/proto/brush';
import { matchesScrape } from '../scrape';
import { recordFromHead, type DeliveryRecord } from '../store';
import { sweepExpiry } from './lease-expiry';
import type { Grant } from './port';
import { refuse } from './refusal';
import { release } from './release';
import { onQueueChange } from './receipts';
import { settle } from './scrape-flow';
import { startSynthesis } from './synth-start';
import type { SinkState } from './state';

/** Verified band buffers of an arrived flow, or null when a CRC failed (the delivery was released, SOLTAR 6). */
function verifiedBands(s: SinkState, h: BrushHead, bytes: Uint8Array): Uint8Array[] | null {
  let bands: Uint8Array[];
  try {
    bands = sliceBands(bytes, h);
  } catch {
    return null;
  }
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const crc = h.crcs[i];
    if (band === undefined || crc === undefined || !verifyBand(band, crc)) {
      release(s, [h.delivery], ReleaseReason.CRC);
      return null;
    }
  }
  return bands;
}

/** A brush Horizon evicted moments ago is on the wire again: the eviction cost a refetch. */
function noteRefetch(s: SinkState, h: BrushHead, bytes: number, at: number): void {
  const d = s.departures.last(brushKey(h.brushId, h.edition));
  if (d?.why === 'evicted' && at - d.at <= REFETCH_WINDOW_MS) s.evictions.refetch(d.delivery, bytes, at - d.at);
}

/** Spec 4.1.6 and 5.4 on one arrived flow: every check, then synthesis. */
function accept(s: SinkState, h: BrushHead, bytes: Uint8Array, now: () => number, leaseS: number): void {
  s.failed.delete(h.delivery);
  const probe = recordFromHead(h);
  const scrape = s.scrapes.find((p) => h.delivery <= p.through && matchesScrape(probe, p.predicate, p.params));
  if (scrape) {
    scrape.scraped += 1; // spec 4.2.4b: a late <= N delivery the predicate covers is dropped on arrival
    return;
  }
  if (s.cancelled.has(h.delivery)) return;
  const bands = verifiedBands(s, h, bytes);
  if (bands === null) return;
  const total = bands.reduce((n, b) => n + b.length, 0);
  const refusal = refuse(s, probe, total);
  if (refusal !== null) {
    console.warn(`Seurat: delivery ${h.delivery} (stratum ${probe.stratum}, bands [${h.from},${h.through})) `
      + `refused (${refusal[0]}): ${refusal[1]}`);
    release(s, [h.delivery], ReleaseReason.BUDGET);
    return;
  }
  noteRefetch(s, h, total, now());
  s.avgDelivery = s.avgDelivery === 0
    ? bytes.length
    : AVG_DELIVERY_KEEP * s.avgDelivery + AVG_DELIVERY_NEW * bytes.length;
  s.largest = Math.max(s.largest, total);
  const rec: DeliveryRecord = {
    ...probe,
    bytes: total,
    expires: now() + leaseS * MS_PER_S,
    bands: bands.map((band) => band.slice().buffer),
    planes: null,
    qY: h.qY,
    qC: h.qC,
    pending: true,
    receiptQueued: false,
    receiptSent: false,
  };
  s.book.byDelivery.set(h.delivery, rec);
  s.nextExpiry = Math.min(s.nextExpiry, rec.expires);
  s.book.inFlight.add(h.delivery);
  s.revision++;
  startSynthesis(s, rec);
  onQueueChange(s);
}

export function ingest(s: SinkState, bytes: Uint8Array, now: () => number, onPaint: () => void, leaseS: number): void {
  s.repaint = (): void => { onPaint(); };
  let h: BrushHead;
  try {
    h = parseBrushHead(bytes);
  } catch {
    return;
  }
  s.rtt.arrived(now());
  s.arrivals.note(bytes.length, now());
  if (h.handle !== s.handle) return;
  if (s.grant !== null && h.epoch > s.grant.epoch && s.early.length < MAX_EARLY_DELIVERIES) {
    // Spec 5.4 / 4.2: a newer epoch than any CONCESION seen is held until that CONCESION arrives.
    s.early.push(() => ingest(s, bytes, now, onPaint, leaseS));
    return;
  }
  sweepExpiry(s, now); // spec 5.2.2: expiry is checked with every incoming message
  try {
    accept(s, h, bytes, now, leaseS);
  } finally {
    settle(s, h.delivery); // applied or dropped, this number is done (spec 4.2.4c)
  }
}

/** CONCESION: checks use it from now on; deliveries that waited for its epoch go in. */
export function concede(s: SinkState, g: Grant): void {
  s.grant = g;
  const early = s.early;
  s.early = [];
  for (const run of early) run();
}
