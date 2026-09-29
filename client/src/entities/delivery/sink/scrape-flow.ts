import { ScrapePredicate } from '@/shared/config/constants';
import type { Scrape } from '@/shared/proto/messages';
import { matchesScrape } from '../scrape';
import { inventoryOf, ownedDeliveries, tallyHeld } from '../store';
import { descendants } from './brush-graph';
import { sweepExpiry } from './lease-expiry';
import { flushRelease } from './release';
import { removeSubtree } from './removal';
import type { PendingScrape } from './port';
import type { SinkState } from './state';

/** RASPADO for every pending order whose range is settled, in order (spec 4.2.5). */
export function answerScrapes(s: SinkState): void {
  while (s.scrapes.length > 0) {
    const r = s.scrapes[0]!;
    if (!s.settlement.settledThrough(r.through, (n) => s.book.byDelivery.has(n))) return;
    s.scrapes.shift();
    flushRelease(s); // SOLTAR first: RASPADO depends on the count
    const keep = ownedDeliveries(s.book).filter((n) => n <= r.through);
    s.port()?.sendScraped(s.handle, r.order, r.epoch, r.through, r.scraped, r.kib, keep);
  }
}

/** This number is done, applied or dropped (spec 4.2.4c): a RASPADO may have been waiting for it. */
export function settle(s: SinkState, n: number): void {
  s.settlement.mark(n);
  answerScrapes(s);
}

/**
 * RASPAR (spec 4.2.4), synchronously before the next control frame: (a) the predicate
 * frees what is held <= N now; (b) late <= N arrivals it covers are dropped on arrival;
 * (c)(d) RASPADO waits until every number <= N is settled, after the pending SOLTAR.
 */
export function applyScrape(s: SinkState, r: Scrape, now: () => number): void {
  const pending: PendingScrape = { ...r, scraped: 0, kib: 0 };
  for (const [n, rec] of [...s.book.byDelivery]) {
    if (n > r.through || !s.book.byDelivery.has(n) || !matchesScrape(rec, r.predicate, r.params)) continue;
    const tally = tallyHeld(s.book, [n, ...descendants(s.book, n)]);
    pending.kib += tally.kib;
    pending.scraped += tally.scraped;
    removeSubtree(s, n, 0, 'scraped');
  }
  s.scrapes.push(pending);
  s.lastScrape = { through: r.through, epoch: r.epoch };
  if (r.predicate === ScrapePredicate.ALL) s.withdrawn = true; // spec 7.4: ERROR 4 follows the RASPADO
  sweepExpiry(s, now);
  answerScrapes(s);
}

/** INVENTARIO content: expiry and SOLTAR come first, the count depends on them. */
export function inventory(s: SinkState, through: number): { brushCount: number; kib: number; ranges: number[] } {
  sweepExpiry(s, () => performance.now());
  flushRelease(s);
  return inventoryOf(s.book, through);
}
