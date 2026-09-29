/** What the sink needs from the session: the frames it sends and the link rate it reads. */
export interface DeliveryPort {
  sendReceipt(handle: number, completed: number[], queueMs: number, free: number, renewThrough: number): void;
  sendRelease(handle: number, reason: number, ranges: number[]): void;
  sendScraped(
    handle: number, order: number, epoch: number, through: number, scrapedCount: number, freedKib: number, kept: number[],
  ): void;
  readonly meter?: { peak(now: number): number };
}

/** The part of the current CONCESION a delivery is checked against on arrival (spec 5.4). */
export interface Grant {
  epoch: number;
  minStratum: number;
  maxBands: number;
}

/** A RASPAR applied to what is held, whose RASPADO waits until every number <= through is settled. */
export interface PendingScrape {
  order: number;
  epoch: number;
  through: number;
  predicate: number;
  params: Uint8Array;
  scraped: number;
  kib: number;
}
