import { DEFAULT_SEED_HEIGHT, DEFAULT_SEED_WIDTH, DEFAULT_STRATA } from '@/shared/config/constants';
import type { Scrape } from '@/shared/proto/messages';
import type { EvictionView } from '../eviction-stats';
import { matchesScrape } from '../scrape';
import { emptyLedger, heldBrushes, type DeliveryLedger, type DeliveryRecord } from '../store';
import { defaultWorker, resolvePoolSize, type WorkerFactory } from '../worker-pool';
import { applyCancelled } from './cancellation';
import { free } from './credit-window';
import { concede, ingest } from './ingest';
import { checkExpiry, sweepExpiry } from './lease-expiry';
import type { DeliveryPort, Grant } from './port';
import { applyRenew, flushReceipt } from './receipts';
import { failSynthesis } from './removal';
import { applyScrape, answerScrapes, inventory } from './scrape-flow';
import { holdLimit, SinkState } from './state';
import { onResult } from './synth-result';
import { relieveNow, reportVramFailure, setView } from './view-focus';

export type { DeliveryPort, Grant } from './port';

/**
 * One canvas's delivery book: the arrived flows, their synthesis and every frame the client owes
 * the server about them (RECIBO, SOLTAR, RASPADO). The modules of this folder hold the rules;
 * this class wires them to one shared `SinkState` and is the surface the rest of the app sees.
 */
export class DeliverySink {
  private readonly s: SinkState;

  constructor(
    handle: number,
    port: () => DeliveryPort | null,
    maxKiB: () => number,
    maxBrushes: () => number,
    seedWidth = DEFAULT_SEED_WIDTH,
    seedHeight = DEFAULT_SEED_HEIGHT,
    strata = DEFAULT_STRATA,
    poolSize: number = resolvePoolSize(),
    createWorker: WorkerFactory = defaultWorker,
  ) {
    const s = new SinkState(handle, port, { maxKiB, maxBrushes }, seedWidth, seedHeight, strata, poolSize, createWorker);
    s.hooks = { fail: (delivery) => failSynthesis(s, delivery), result: (index, ev) => onResult(s, index, ev) };
    this.s = s;
  }

  get handle(): number { return this.s.handle; }
  get book(): DeliveryLedger { return this.s.book; }
  get revision(): number { return this.s.revision; }
  get renewThrough(): number { return this.s.renewThrough; }
  get withdrawn(): boolean { return this.s.withdrawn; }
  get seedWidth(): number { return this.s.seedWidth; }
  get seedHeight(): number { return this.s.seedHeight; }
  get strata(): number { return this.s.strata; }
  get top(): number { return this.s.top; }
  get queueDepthMs(): number { return this.s.decode.ms; }
  get avgDeliveryBytes(): number { return this.s.avgDelivery; }
  /** Brushes this viewer holds at most: the Settings cap narrowing the concession. */
  get holdLimit(): number { return holdLimit(this.s); }

  /** Local eviction counters for telemetry. */
  get eviction(): EvictionView { return this.s.evictions.view(); }
  /** Upper bound of the plane memory the synthesis workers may cache. */
  get workerCacheBound(): number { return this.s.pool?.cacheBoundBytes() ?? 0; }

  /** Pool observability for telemetry: size, busy workers, queued jobs. */
  get synthLoad(): { size: number; busy: number; waiting: number } {
    const { pool, ready } = this.s;
    return { size: pool?.size ?? 0, busy: pool?.busyCount() ?? 0, waiting: ready.size };
  }

  ingest(bytes: Uint8Array, now: () => number, onPaint: () => void, leaseS: number): void {
    ingest(this.s, bytes, now, onPaint, leaseS);
  }

  concede(g: Grant): void { concede(this.s, g); }

  applyPlanCanceladas(ranges: number[]): void { applyCancelled(this.s, ranges); }

  applyScrape(r: Scrape, now: () => number): void { applyScrape(this.s, r, now); }

  /**
   * PLAN INICIO for MIRADA `gazeSeq`: after a resume, numbers below `first` that never came are
   * gone; views before that MIRADA stop being painted once every number below `first` settles.
   */
  planStart(first: number, gazeSeq = 0): void {
    this.s.settlement.planStart(first);
    this.s.cones.planStart(gazeSeq, first);
    answerScrapes(this.s);
  }

  /** REANUDAR accepted: the old connection's in-flight numbers will never arrive; RASPAR are re-sent. */
  resumed(): void {
    this.s.settlement.resume();
    this.s.scrapes = [];
  }

  applyRenew(ranges: number[], order: number, leaseS: number, now: () => number): void {
    applyRenew(this.s, ranges, order, leaseS, now);
  }

  inventory(through: number): { brushCount: number; kib: number; ranges: number[] } {
    return inventory(this.s, through);
  }

  checkExpiry(now: number): void { checkExpiry(this.s, now); }
  sweepExpiry(now: () => number): void { sweepExpiry(this.s, now); }

  setView(x0: number, y0: number, x1: number, y1: number, vw: number, vh: number, seq = 0): void {
    setView(this.s, x0, y0, x1, y1, vw, vh, seq);
  }

  reportVramFailure(): void { reportVramFailure(this.s); }

  /** The brush cap changed: apply it now (eviction down to it, or a wider RECIBO window). */
  relieveNow(): void { relieveNow(this.s); }
  /** The work's size (ABIERTA), image px: which core brushes exist to be missing. */
  setExtent(w: number, h: number): void { this.s.extent = { w, h }; }

  /** RECIBO.libre: what the window still allows (memory and link). */
  free(): number { return free(this.s); }

  /** Brushes held (brush+edition, however many deliveries): what the cap and max_pinceladas count. */
  heldBrushes(): number { return heldBrushes(this.s.book); }

  /** Send the pending RECIBO now (SOLTAR first, eviction if the book is under pressure). */
  flushReceipt(): void { flushReceipt(this.s); }

  matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
    return matchesScrape(rec, predicate, params);
  }

  dispose(): void {
    const s = this.s;
    clearTimeout(s.receiptTimer);
    clearTimeout(s.releaseTimer);
    s.pool?.dispose();
    s.pool = null;
    s.ready.clear();
    s.pending.clear();
    s.activeSynthesis.clear();
    s.inflight.clear();
    s.origin.clear();
    s.failed.clear();
    for (const rec of s.book.byDelivery.values()) rec.rgba?.close();
    s.book = emptyLedger();
    s.revision++;
  }
}
