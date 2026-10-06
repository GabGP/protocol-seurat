import { ScrapePredicate } from '@/shared/config/constants';
import type { DeliveryRecord } from './store';

/** Protocol RASPAR predicate: single implementation for all ledgers. */
export function matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
  switch (predicate) {
    case ScrapePredicate.ALL:
      return true;
    case ScrapePredicate.LOW_STRATUM: {
      const stratum = params[0] ?? 0;
      return rec.stratum < stratum;
    }
    default:
      return false;
  }
}
