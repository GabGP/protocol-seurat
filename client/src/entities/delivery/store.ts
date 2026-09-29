import { splitBrushId, type BrushHead } from '@/shared/proto/brush';
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
  /** Validated wire bands are retained as the canonical synthesis source. */
  bands?: ArrayBuffer[];
  planes?: ArrayBuffer[] | null;
  qY?: number;
  qC?: number;
  pending?: boolean;
  receiptQueued?: boolean;
  receiptSent?: boolean;
  parentDelivery?: number;
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
  return { ...rec, rgba: null, bands: [], planes: null };
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

/** INVENTARIO content: the brushes held, their size, and the numbers <= through (exact set equality on the wire). */
export function inventoryOf(b: DeliveryLedger, through: number): { brushCount: number; kib: number; ranges: number[] } {
  const brushCount = new Set([...b.byDelivery.values()].map((r) => r.brushId.toString())).size;
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
