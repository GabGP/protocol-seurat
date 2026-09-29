import { Reader } from '../reader';
import { rangesEncode } from '../ranges';
import { concat, viEncode } from '../varint';

export interface Scrape { handle: number; order: number; epoch: number; through: number; predicate: number; params: Uint8Array }
export function scrapeCore(r: Scrape): Uint8Array {
  return concat(viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through), [r.predicate], r.params);
}
export function scrapeDecode(payload: Uint8Array): Scrape {
  const r = new Reader(payload);
  return {
    handle: r.vi(), order: r.vi(), epoch: r.vi(), through: r.vi(), predicate: r.u8(), params: r.rest(),
  };
}
export function scrapeParamsLowStratum(stratum: number): Uint8Array {
  return Uint8Array.from([stratum]);
}
export function scrapeParamsOutside(x0: number, y0: number, x1: number, y1: number): Uint8Array {
  return concat(viEncode(x0), viEncode(y0), viEncode(x1), viEncode(y1));
}
export function scrapeParamsBands(stratum: number, maxBands: number): Uint8Array {
  return Uint8Array.from([stratum, maxBands]);
}
export function scrapeParamsList(ranges: number[]): Uint8Array {
  return rangesEncode(ranges);
}

export interface Scraped {
  handle: number; order: number; epoch: number; through: number;
  scrapedCount: number; freedKib: number; kept: number[];
}
export function scrapedCore(r: Scraped): Uint8Array {
  return concat(
    viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through),
    viEncode(r.scrapedCount), viEncode(r.freedKib), rangesEncode(r.kept),
  );
}
export function scrapedDecode(payload: Uint8Array): Scraped {
  const r = new Reader(payload);
  return {
    handle: r.vi(), order: r.vi(), epoch: r.vi(), through: r.vi(),
    scrapedCount: r.vi(), freedKib: r.vi(), kept: r.ranges(),
  };
}
