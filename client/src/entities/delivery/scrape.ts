import { ScrapePredicate, SKETCH_MIN, TILE } from '@/shared/config/constants';
import { splitBrushId } from '@/shared/proto/brush';
import { rangesDecode } from '@/shared/proto/ranges';
import { viDecode } from '@/shared/proto/varint';
import type { DeliveryRecord } from './store';

/** Protocol RASPAR predicate (5 predicates) — single implementation for all ledgers. */
export function matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
  switch (predicate) {
    case ScrapePredicate.ALL:
      return true;
    case ScrapePredicate.LOW_STRATUM: {
      const stratum = params[0] ?? 0;
      return rec.stratum < stratum;
    }
    case ScrapePredicate.BANDS: {
      const stratum = params[0] ?? 0;
      const bandasMax = params[1] ?? 0;
      return rec.stratum === stratum && rec.through > bandasMax;
    }
    case ScrapePredicate.LIST: {
      try {
        return rangesDecode(params, 0).values.includes(rec.delivery);
      } catch {
        return false;
      }
    }
    case ScrapePredicate.OUTSIDE: {
      try {
        if (rec.stratum >= SKETCH_MIN) return false;
        let p = 0;
        let r = viDecode(params, p);
        const x0 = r.value;
        p = r.next;
        r = viDecode(params, p);
        const y0 = r.value;
        p = r.next;
        r = viDecode(params, p);
        const x1 = r.value;
        p = r.next;
        r = viDecode(params, p);
        const y1 = r.value;
        const { stratum, bx, by } = splitBrushId(rec.brushId);
        const size = TILE * 2 ** stratum;
        const px0 = bx * size;
        const py0 = by * size;
        const px1 = px0 + size;
        const py1 = py0 + size;
        const intersects = px0 < x1 && px1 > x0 && py0 < y1 && py1 > y0;
        return !intersects;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}
