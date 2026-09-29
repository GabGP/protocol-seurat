import type { Scrape } from '@/shared/proto/messages';
import { matchesScrape } from './scrape';
import { emptyLedger, inventoryOf, ownedDeliveries, tallyHeld, type DeliveryLedger, type DeliveryRecord } from './store';

/**
 * Bookkeeping for handles not owned by the live sink (previews, retired
 * sinks). Server RASPADO/AUDITAR must never be answered with a bare []
 * when we do hold numbers: exact-set mismatch is fatal.
 * Bounded FIFO: retired canvases only answer in-flight messages.
 */
export class HandleLedgers {
  private books = new Map<number, DeliveryLedger>();

  constructor(private readonly maxHandles: number) {}

  record(handle: number, rec: DeliveryRecord): void {
    let book = this.books.get(handle);
    if (!book) {
      book = emptyLedger();
      this.books.set(handle, book);
      this.evict();
    }
    book.byDelivery.set(rec.delivery, rec);
  }

  /** Take over a disposed sink's numbers (rgba already closed by caller). */
  adopt(handle: number, from: DeliveryLedger): void {
    let book = this.books.get(handle);
    if (!book) {
      book = emptyLedger();
      this.books.set(handle, book);
      this.evict();
    }
    for (const rec of from.byDelivery.values()) book.byDelivery.set(rec.delivery, rec);
  }

  inventory(handle: number, through: number): { brushCount: number; kib: number; ranges: number[] } {
    const book = this.books.get(handle);
    if (!book) return { brushCount: 0, kib: 0, ranges: [] };
    return inventoryOf(book, through);
  }

  /** Server-ordered scrape: drop matches, answer with the kept set. */
  applyScrape(r: Scrape): { scraped: number; kib: number; keep: number[] } {
    const book = this.books.get(r.handle);
    if (!book) return { scraped: 0, kib: 0, keep: [] };
    const matched = [...book.byDelivery]
      .filter(([n, rec]) => n <= r.through && matchesScrape(rec, r.predicate, r.params))
      .map(([n]) => n);
    const tally = tallyHeld(book, matched);
    for (const n of matched) {
      book.byDelivery.get(n)?.rgba?.close();
      book.byDelivery.delete(n);
    }
    return { ...tally, keep: ownedDeliveries(book).filter((n) => n <= r.through) };
  }

  canceladas(handle: number, ranges: number[]): void {
    const book = this.books.get(handle);
    if (!book) return;
    for (const n of ranges) book.byDelivery.delete(n);
  }

  clear(): void {
    for (const book of this.books.values()) {
      for (const rec of book.byDelivery.values()) rec.rgba?.close();
    }
    this.books.clear();
  }

  private evict(): void {
    while (this.books.size > this.maxHandles) {
      const oldest = this.books.keys().next();
      if (oldest.done) return;
      const book = this.books.get(oldest.value);
      for (const rec of book?.byDelivery.values() ?? []) rec.rgba?.close();
      this.books.delete(oldest.value);
    }
  }
}
