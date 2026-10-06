import { Reader } from '../reader';
import { teselasEncode } from '../teselas';
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

export interface Scraped {
  handle: number; order: number; epoch: number; through: number;
  scrapedCount: number; freedKib: number; kept: number[];
}
export function scrapedCore(r: Scraped): Uint8Array {
  return concat(
    viEncode(r.handle), viEncode(r.order), viEncode(r.epoch), viEncode(r.through),
    viEncode(r.scrapedCount), viEncode(r.freedKib), teselasEncode(r.kept),
  );
}
export function scrapedDecode(payload: Uint8Array): Scraped {
  const r = new Reader(payload);
  return {
    handle: r.vi(), order: r.vi(), epoch: r.vi(), through: r.vi(),
    scrapedCount: r.vi(), freedKib: r.vi(), kept: r.teselas(),
  };
}
