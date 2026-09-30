import { brushKey, splitBrushId, type BrushHead } from '@/shared/proto/brush';
import { toKib } from '@/shared/config/constants';
import { rangesEqual } from '@/shared/proto/ranges';

export interface DeliveryRecord {
  delivery: number;
  brushId: bigint;
  stratum: number;
  from: number;
  through: number;
  bytes: number;
  epoch: number;
  edition: number;
  expires: number;
  rgba: ImageBitmap | null;
  /**
   * Identity of the bitmap this delivery last landed (0 = none). It outlives `rgba`: once the atlas
   * holds the pixels the bitmap is closed, and the atlas keeps finding its layer by this number.
   */
  image?: number;
  /** Validated wire bands are retained as the canonical synthesis source. */
  bands?: ArrayBuffer[];
  planes?: ArrayBuffer[] | null;
  /** Which synthesis made `planes` (`planesKey`): the one name a worker caches that exact content under. */
  planesKey?: string;
  qY?: number;
  qC?: number;
  pending?: boolean;
  receiptQueued?: boolean;
  receiptSent?: boolean;
  parentDelivery?: number;
}

let lastImage = 0;

/** A fresh identity for a landed bitmap (global, so two sinks never share one). */
export function nextImageId(): number {
  return ++lastImage;
}

/** True while the brush has pixels to show: the bitmap, or a GPU copy released from it. */
export function hasPixels(rec: { rgba: ImageBitmap | null; image?: number }): boolean {
  return rec.rgba !== null || (rec.image ?? 0) > 0;
}

/** The record of an arrived head before its bytes are counted: what scrape predicates read. */
export function recordFromHead(h: BrushHead): DeliveryRecord {
  return {
    delivery: h.delivery, brushId: h.brushId, stratum: splitBrushId(h.brushId).stratum,
    from: h.from, through: h.through, bytes: 0, epoch: h.epoch, edition: h.edition, expires: 0, rgba: null,
  };
}

/**
 * What a retired ledger keeps of a record: the numbers RASPADO/INVENTARIO answer with, no pixels
 * and no bands (the sink that owned them is gone). The caller closes the original's bitmap.
 */
export function slimRecord(rec: DeliveryRecord): DeliveryRecord {
  return { ...rec, rgba: null, image: 0, bands: [], planes: null, planesKey: undefined };
}

export interface DeliveryLedger {
  byDelivery: Map<number, DeliveryRecord>;
  inFlight: Set<number>;
  pendingReceipt: number[];
  pendingScrapes: Array<{ order: number; through: number }>;
  parentOf: Map<number, number>;
  childrenOf: Map<number, Set<number>>;
}

export function emptyLedger(): DeliveryLedger {
  return {
    byDelivery: new Map(), inFlight: new Set(), pendingReceipt: [], pendingScrapes: [],
    parentOf: new Map(), childrenOf: new Map(),
  };
}

export function ownedDeliveries(b: DeliveryLedger): number[] {
  return [...b.byDelivery.keys()].sort((a, b2) => a - b2);
}

export function ownedBytes(b: DeliveryLedger): number {
  let n = 0;
  for (const r of b.byDelivery.values()) n += r.bytes;
  return n;
}

/** Brushes held: distinct brush+edition, the unit of max_pinceladas, RECIBO.libre and the cap (spec 4.1 c, 5.4). */
export function heldBrushes(b: DeliveryLedger): number {
  const keys = new Set<string>();
  for (const r of b.byDelivery.values()) keys.add(brushKey(r.brushId, r.edition));
  return keys.size;
}

/** True when a delivery of this brush in this edition is held: a further one takes no new slot. */
export function holdsBrush(b: DeliveryLedger, brushId: bigint, edition: number): boolean {
  for (const r of b.byDelivery.values()) if (r.brushId === brushId && r.edition === edition) return true;
  return false;
}

/** INVENTARIO content: the brushes held, their size, and the numbers <= through (exact set equality on the wire). */
export function inventoryOf(b: DeliveryLedger, through: number): { brushCount: number; kib: number; ranges: number[] } {
  const brushCount = heldBrushes(b);
  return { brushCount, kib: toKib(ownedBytes(b)), ranges: ownedDeliveries(b).filter((n) => n <= through) };
}

/** RASPADO's freed-KiB count for the numbers still held among `ids`. */
export function tallyHeld(b: DeliveryLedger, ids: number[]): { scraped: number; kib: number } {
  let scraped = 0;
  let kib = 0;
  for (const id of ids) {
    const held = b.byDelivery.get(id);
    if (!held) continue;
    kib += toKib(held.bytes);
    scraped += 1;
  }
  return { scraped, kib };
}

export function confirmScraped(keep: number[], through: number, expected: number[]): boolean {
  const got = keep.filter((n) => n <= through);
  return rangesEqual(got, expected);
}

export function effectiveExpiry(rec: DeliveryRecord, parentVence: number | null): number {
  return parentVence === null ? rec.expires : Math.min(rec.expires, parentVence);
}
