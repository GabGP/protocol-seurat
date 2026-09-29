import {
  BYTES_PER_KIB, EVICT_HEADROOM, EVICT_PRESSURE, EVICT_TARGET, MS_PER_S, RECEIPT_EVERY_N, RECEIPT_EVERY_MS, RELEASE_BATCH_MS,
  ReleaseReason, ScrapePredicate, SEED_STRATUM, SKETCH_MIN, TILE, toKib,
} from '@/shared/config/constants';
import { byteRoom, coming, receiverWindow } from '@/entities/delivery/credit';
import { DecodeQueue } from '@/entities/delivery/decode-queue';
import { AttentionHeat } from '@/entities/delivery/attention-heat';
import { collectCandidates, inCore, ownedBrushes, type EvictView } from '@/entities/delivery/evict-candidate';
import { Departures, type Departure } from '@/entities/delivery/departures';
import { PaintedCones } from '@/entities/delivery/painted-cones';
import { GazeMotion } from '@/entities/delivery/gaze-motion';
import { rankHorizon } from '@/entities/delivery/horizon-rank';
import { SynthQueue, type ReadyJob } from '@/entities/delivery/synth-queue';
import { WorkerPool, defaultWorker, resolvePoolSize, type WorkerFactory } from '@/entities/delivery/worker-pool';
import { makeBrushId, brushKey, parentBrushId, parseBrushHead, splitBrushId, sliceBands, verifyBand } from '@/shared/proto/brush';
import type { Scrape } from '@/shared/proto/messages';
import { matchesScrape as scrapeMatches } from '@/entities/delivery/scrape';
import { effectiveExpiry, emptyLedger, ownedBytes, ownedDeliveries, recordFromHead, type DeliveryLedger, type DeliveryRecord } from '@/entities/delivery/store';
import { Settlement } from '@/entities/delivery/settlement';
import { STALE_PARENT, type SynthRequest, type SynthResult } from '@/workers/protocol';
import type { SessionClient } from './session-client';
import { clamp } from '@/shared/lib/clamp';

/** cola_ms from which the server caps or stops plans (ConePlanner: 150 / 400). */
const COLA_BUSY_MS = 150;

/** A RASPAR applied to what is held, whose RASPADO waits until every number ≤ through is settled. */
interface PendingScrape {
  order: number;
  epoch: number;
  through: number;
  predicate: number;
  params: Uint8Array;
  scraped: number;
  kib: number;
}

/** The part of the current CONCESION a delivery is checked against on arrival (spec 5.4). */
export interface Grant {
  epoch: number;
  minStratum: number;
  maxBands: number;
}

/** Early (future-epoch) deliveries held at most: max_en_vuelo. */
const MAX_EARLY = 12;

export class DeliverySink {
  book: DeliveryLedger = emptyLedger();
  renewThrough = 0;
  private static nextRevision = 1;
  /** Bumped on every book mutation; paint caches key on it, not just paintTick. */
  revision = DeliverySink.nextRevision++;
  private pool: WorkerPool | null = null;
  private readonly ready = new SynthQueue();
  private receiptTimer = 0;
  private releaseTimer = 0;
  private expiredQueue: number[] = [];
  /** The earliest lease end in the book (renewals only push it later): no sweep is due before it. */
  private nextExpiry = Infinity;
  private readonly decode = new DecodeQueue();
  private scrapes: PendingScrape[] = [];
  private lastScrape: { through: number; epoch: number } | null = null;
  private cancelled = new Set<number>();
  private readonly settlement = new Settlement();
  private grant: Grant | null = null;
  /** A RASPAR TODO arrived: the work is being withdrawn. */
  withdrawn = false;
  /** Deliveries of an epoch whose CONCESION has not arrived yet (flows can overtake control). */
  private early: Array<() => void> = [];
  private avgDelivery = 0;
  /** The largest delivery held so far (band bytes): what the byte window reserves per brush. */
  private largest = 0;
  private linkBps = 0;
  private pending = new Map<number, { req: SynthRequest; parentId: bigint; edition: number }>();
  private failed = new Set<number>();
  private nextSynthesisId = 1;
  private activeSynthesis = new Map<number, number>();
  /** brushKey → worker index holding its planes (ref routing + stickiness). */
  private origin = new Map<string, number>();
  /** Sent but unanswered: kept for byte-retry after a cache miss. */
  private inflight = new Map<number, { req: SynthRequest; brushId: bigint; epoch: number }>();
  private repaint = (): void => undefined;
  private view: EvictView | null = null;
  /** This view and the past ones the server may still be painting: never evicted from. */
  private readonly cones = new PaintedCones();
  /** Why brushes left the book, for the refusal log. */
  private readonly departures = new Departures();
  /** When `view` went on screen (s), so its brushes get the dwell as attention heat. */
  private viewSince = 0;
  private readonly gaze = new GazeMotion();
  private readonly heat = new AttentionHeat();
  private lastFree = -1;
  private lastQueue = 0;
  private lastRenew = 0;

  constructor(
    public readonly handle: number,
    private client: () => SessionClient | null,
    private maxKiB: () => number,
    private maxBrushes: () => number,
    public seedWidth = 192,
    public seedHeight = 160,
    public strata = 11,
    private poolSize: number = resolvePoolSize(),
    private createWorker: WorkerFactory = defaultWorker,
  ) {}

  get top(): number {
    return Math.max(0, this.strata - 1);
  }

  private ensurePool(): WorkerPool {
    if (this.pool) return this.pool;
    const pool = new WorkerPool(this.poolSize, this.createWorker);
    pool.onResults((index, ev) => this.onResult(index, ev));
    this.decode.setParallelism(pool.size);
    this.pool = pool;
    return pool;
  }

  /** A synthesis whose parents are done: claim its identity, queue it, run what fits. */
  private enqueue(req: SynthRequest, brushId: bigint, epoch: number, refOk = true): void {
    this.activeSynthesis.set(req.delivery, req.synthesisId);
    this.ready.push({ req, brushId, epoch, distTiles: this.distTiles(brushId), refOk });
    this.decode.setWaiting(this.ready.size);
    this.pump();
  }

  /** Post ready jobs to idle workers; drop jobs whose delivery died waiting. */
  private pump(): void {
    if (this.ready.size === 0) return;
    const pool = this.ensurePool();
    for (;;) {
      if (pool.idleIndex() < 0) break;
      const job = this.ready.pop();
      if (!job) break;
      if (!this.book.byDelivery.has(job.req.delivery)) continue;
      if (this.activeSynthesis.get(job.req.delivery) !== job.req.synthesisId) continue;
      try {
        const index = this.pickWorker(pool, job);
        const transfers = [...job.req.bands];
        if (job.req.parentPlanes) transfers.push(...job.req.parentPlanes);
        pool.send(index, job.req, transfers);
        this.inflight.set(job.req.delivery, { req: job.req, brushId: job.brushId, epoch: job.epoch });
        this.decode.posted();
      } catch {
        this.inflight.delete(job.req.delivery);
        this.failSynthesis(job.req.delivery);
      }
    }
    this.decode.setWaiting(this.ready.size);
  }

  /**
   * Sticky when the parent's worker is free: its plane cache likely still holds
   * the parent, so the child goes by reference and skips the transfer. Bytes go
   * otherwise (and populate that worker's cache under the parent key).
   */
  private pickWorker(pool: WorkerPool, job: ReadyJob): number {
    if (job.refOk && job.req.parentKey !== undefined) {
      const pref = this.origin.get(job.req.parentKey);
      if (pref !== undefined && pool.isIdle(pref)) {
        job.req.parentRef = job.req.parentKey;
        job.req.parentPlanes = undefined;
        return pref;
      }
    }
    const idle = pool.idleIndex();
    if (idle < 0) throw new Error('no idle synthesis worker');
    return idle;
  }

  /** The assigned worker had evicted the parent: re-attach bytes and requeue. */
  private retryWithBytes(req: SynthRequest, brushId: bigint, epoch: number): void {
    const rec = this.book.byDelivery.get(req.delivery);
    if (!rec) return;
    const { stratum, bx, by } = splitBrushId(brushId);
    const parent = this.parentFor(stratum, bx, by, req.edition, rec.epoch);
    if (!parent?.planes) {
      this.failSynthesis(req.delivery);
      return;
    }
    this.linkParent(req.delivery, parent.delivery);
    req.parentRef = undefined;
    req.bands = this.brushBands(rec); // the first post transferred (detached) the old copies
    this.withParent(req, parent, bx, by);
    this.enqueue(req, brushId, epoch, false);
  }

  private distTiles(brushId: bigint): number {
    const v = this.view;
    if (!v) return 0;
    const { stratum, bx, by } = splitBrushId(brushId);
    const side = TILE * 2 ** stratum;
    const cx = (v.x0 + v.x1) / 2;
    const cy = (v.y0 + v.y1) / 2;
    return Math.floor(Math.hypot(bx * side + side / 2 - cx, by * side + side / 2 - cy) / TILE);
  }

  private onResult(index: number, ev: MessageEvent): void {
    const out = ev.data as SynthResult;
    this.decode.answered(out.elapsedMs);
    this.pool?.complete(index);
    // The server plans nothing while the last cola_ms said we were busy (spec §6.1): tell it we caught up.
    if (this.lastQueue >= COLA_BUSY_MS && this.decode.ms < COLA_BUSY_MS) this.flushReceipt();
    this.pump();
    if (this.activeSynthesis.get(out.delivery) !== out.synthesisId) {
      out.bitmap?.close();
      return;
    }
    const ctx = this.inflight.get(out.delivery);
    this.inflight.delete(out.delivery);
    if (!out.ok || (!out.rgba && !out.bitmap)) {
      if (out.error === STALE_PARENT && ctx) {
        this.retryWithBytes(ctx.req, ctx.brushId, ctx.epoch);
        return;
      }
      this.failSynthesis(out.delivery);
      return;
    }
    const rec0 = this.book.byDelivery.get(out.delivery);
    if (rec0) this.origin.set(brushKey(rec0.brushId, rec0.edition), index);
    const ready = out.bitmap
      ? Promise.resolve(out.bitmap)
      : createImageBitmap(new ImageData(new Uint8ClampedArray(out.rgba ?? new ArrayBuffer(0)), out.width, out.height));
    ready
      .then((bmp) => {
        if (this.activeSynthesis.get(out.delivery) !== out.synthesisId) {
          bmp.close();
          return;
        }
        const rec = this.book.byDelivery.get(out.delivery);
        if (rec) {
          rec.rgba?.close(); // a resynthesis keeps showing the old image until this one lands
          rec.rgba = bmp;
          rec.planes = out.planes;
          this.revision++;
          rec.pending = false;
          if (!rec.receiptQueued && !rec.receiptSent) {
            rec.receiptQueued = true;
            this.book.pendingReceipt.push(out.delivery);
          }
          this.replaceOlderEditions(rec);
          this.notifyPaint();
          this.resynthesizeChildren(out.delivery);
          this.flushPending();
          this.maybeFlushReceipt();
        } else {
          bmp.close();
        }
      })
      .catch(() => {
        if (this.activeSynthesis.get(out.delivery) === out.synthesisId) this.failSynthesis(out.delivery);
      });
  }

  ingest(
    bytes: Uint8Array,
    now: () => number,
    onPaint: () => void,
    leaseS: number,
  ): void {
    this.repaint = (): void => { onPaint(); };
    let h;
    try {
      h = parseBrushHead(bytes);
    } catch {
      return;
    }
    if (h.handle !== this.handle) return;
    if (this.grant !== null && h.epoch > this.grant.epoch && this.early.length < MAX_EARLY) {
      // Spec 5.4 / 4.2: a newer epoch than any CONCESION seen is held until that CONCESION arrives.
      this.early.push(() => this.ingest(bytes, now, onPaint, leaseS));
      return;
    }
    this.sweepExpiry(now); // spec 5.2.2: expiry is checked with every incoming message
    try {
      this.accept(h, bytes, now, leaseS);
    } finally {
      this.settle(h.delivery); // applied or dropped, this number is done (spec 4.2.4c)
    }
  }

  /** Spec 4.1.6 and 5.4 on one arrived flow: every check, then synthesis. */
  private accept(h: ReturnType<typeof parseBrushHead>, bytes: Uint8Array, now: () => number, leaseS: number): void {
    this.failed.delete(h.delivery);
    const probe = recordFromHead(h);
    const scrape = this.scrapes.find((p) => h.delivery <= p.through && this.matchesScrape(probe, p.predicate, p.params));
    if (scrape) {
      scrape.scraped += 1; // spec 4.2.4b: a late ≤ N delivery the predicate covers is dropped on arrival
      return;
    }
    if (this.cancelled.has(h.delivery)) return;
    let bands;
    try {
      bands = sliceBands(bytes, h);
    } catch {
      return;
    }
    for (let i = 0; i < bands.length; i++) {
      const band = bands[i];
      const crc = h.crcs[i];
      if (band === undefined || crc === undefined || !verifyBand(band, crc)) {
        this.release([h.delivery], ReleaseReason.CRC);
        return;
      }
    }
    const total = bands.reduce((n, b) => n + b.length, 0);
    const refusal = this.refuse(probe, total);
    if (refusal !== null) {
      console.warn(`Seurat: delivery ${h.delivery} (stratum ${probe.stratum}, bands [${h.from},${h.through})) `
        + `refused (${refusal[0]}): ${refusal[1]}`);
      this.release([h.delivery], ReleaseReason.BUDGET);
      return;
    }
    this.avgDelivery = this.avgDelivery === 0 ? bytes.length : 0.8 * this.avgDelivery + 0.2 * bytes.length;
    this.largest = Math.max(this.largest, total);
    const split = splitBrushId(h.brushId);
    const retainedBands = bands.map((band) => band.slice().buffer);
    const rec: DeliveryRecord = {
      ...probe,
      bytes: total,
      expires: now() + leaseS * MS_PER_S,
      bands: retainedBands,
      planes: null,
      qY: h.qY,
      qC: h.qC,
      pending: true,
      receiptQueued: false,
      receiptSent: false,
    };
    this.book.byDelivery.set(h.delivery, rec);
    this.nextExpiry = Math.min(this.nextExpiry, rec.expires);
    this.book.inFlight.add(h.delivery);
    this.revision++;
    const req: SynthRequest = {
      delivery: h.delivery,
      synthesisId: this.nextSynthesisId++,
      stratum: split.stratum,
      qY: h.qY,
      qC: h.qC,
      seed: split.stratum === SEED_STRATUM,
      seedWidth: this.seedWidth,
      seedHeight: this.seedHeight,
      brush: brushKey(h.brushId, h.edition),
      edition: h.edition,
      bands: this.brushBands(rec),
    };
    const parent = this.parentFor(split.stratum, split.bx, split.by, h.edition, h.epoch);
    if (parent) this.linkParent(h.delivery, parent.delivery);
    if (parent?.planes) this.withParent(req, parent, split.bx, split.by);
    if (split.stratum < SEED_STRATUM && !parent?.planes) {
      const parentId = parentBrushId(split.stratum, split.bx, split.by, this.top);
      this.pending.set(h.delivery, { req, parentId, edition: h.edition });
      return;
    }
    this.enqueue(req, h.brushId, h.epoch);
  }

  private flushPending(): void {
    for (const [delivery, item] of this.pending) {
      const rec = this.book.byDelivery.get(delivery);
      if (!rec) continue;
      const { stratum, bx, by } = splitBrushId(rec.brushId);
      const parent = this.parentFor(stratum, bx, by, item.edition, rec.epoch);
      if (!parent?.planes) continue;
      this.linkParent(delivery, parent.delivery);
      this.withParent(item.req, parent, bx, by);
      this.pending.delete(delivery);
      this.enqueue(item.req, rec.brushId, rec.epoch);
    }
  }

  private parentFor(stratum: number, bx: number, by: number, edition?: number, epoch?: number): DeliveryRecord | null {
    if (stratum >= SEED_STRATUM) return null;
    const parentId = parentBrushId(stratum, bx, by, this.top);
    let best: DeliveryRecord | null = null;
    for (const rec of this.book.byDelivery.values()) {
      if (rec.brushId !== parentId) continue;
      if (edition !== undefined && rec.edition !== edition) continue;
      if (epoch !== undefined && rec.epoch > epoch) continue;
      if (best === null) {
        best = rec;
        continue;
      }
      const diff =
        (rec.epoch - best.epoch) ||
        (Number(rec.planes != null) - Number(best.planes != null)) ||
        (rec.delivery - best.delivery);
      if (diff > 0) {
        best = rec;
      }
    }
    return best;
  }

  /** Each delivery of a brush carries some of its bands (disjoint masks): synthesis decodes them all. */
  private brushBands(rec: DeliveryRecord): ArrayBuffer[] {
    return this.sameBrush(rec).flatMap((r) => (r.bands ?? []).map((b) => b.slice(0)));
  }

  private sameBrush(rec: DeliveryRecord): DeliveryRecord[] {
    const out: DeliveryRecord[] = [];
    for (const r of this.book.byDelivery.values()) {
      if (r.brushId === rec.brushId && r.edition === rec.edition) out.push(r);
    }
    return out;
  }

  private withParent(req: SynthRequest, parent: DeliveryRecord, bx: number, by: number): void {
    const seed = parent.stratum === SEED_STRATUM;
    req.parentKey = brushKey(parent.brushId, parent.edition);
    req.parentPlanes = (parent.planes ?? []).map((plane) => plane.slice(0));
    req.parentPlaneWidth = seed ? this.seedWidth : 256;
    req.parentPlaneHeight = seed ? this.seedHeight : 256;
    req.parentX = seed ? bx * 128 : (bx & 1) * 128;
    req.parentY = seed ? by * 128 : (by & 1) * 128;
  }

  private linkParent(child: number, parent: number): void {
    // Re-linking (sketch parent -> synthesized parent) moves the link; a stale one would make the old
    // parent look like it still has children, so eviction could never drop it.
    const old = this.book.parentOf.get(child);
    if (old !== undefined && old !== parent) this.book.childrenOf.get(old)?.delete(child);
    this.book.parentOf.set(child, parent);
    const children = this.book.childrenOf.get(parent) ?? new Set<number>();
    children.add(child);
    this.book.childrenOf.set(parent, children);
    const rec = this.book.byDelivery.get(child);
    if (rec) rec.parentDelivery = parent;
  }

  private unlink(delivery: number): void {
    const parent = this.book.parentOf.get(delivery);
    if (parent !== undefined) this.book.childrenOf.get(parent)?.delete(delivery);
    this.book.parentOf.delete(delivery);
    this.book.childrenOf.delete(delivery);
  }

  private descendants(root: number): number[] {
    const out: number[] = [];
    const visit = (n: number): void => {
      for (const child of this.book.childrenOf.get(n) ?? []) {
        out.push(child);
        visit(child);
      }
    };
    visit(root);
    return out;
  }

  private removeSubtree(root: number, reason: number, why: Departure): number[] {
    const all = [root, ...this.descendants(root)];
    const removed = new Set(all);
    this.book.pendingReceipt = this.book.pendingReceipt.filter((n) => !removed.has(n));
    const [held, max, at] = [this.book.byDelivery.size, this.maxBrushes(), performance.now()];
    for (const n of all) {
      const gone = this.book.byDelivery.get(n);
      if (gone) this.departures.note(brushKey(gone.brushId, gone.edition), why, n, at, held, max);
      this.settlement.mark(n); // it was held, so it arrived: settled whatever happens to it now
      this.pending.delete(n);
      this.inflight.delete(n);
      const rec = this.book.byDelivery.get(n);
      if (rec) this.origin.delete(brushKey(rec.brushId, rec.edition));
      rec?.rgba?.close();
      this.book.byDelivery.delete(n);
      this.book.inFlight.delete(n);
      this.activeSynthesis.delete(n);
      this.unlink(n);
    }
    if (reason !== 0) this.release(all, reason);
    this.revision++;
    this.pump(); // prune heap jobs whose delivery just died, refill freed workers
    return all;
  }

  private failSynthesis(delivery: number): void {
    if (this.failed.has(delivery)) return;
    const rec = this.book.byDelivery.get(delivery);
    this.failed.add(delivery);
    if (!rec) return;
    this.book.pendingReceipt = this.book.pendingReceipt.filter((n) => n !== delivery);
    const removed = this.removeSubtree(delivery, 0, 'failed synthesis');
    this.release(removed, ReleaseReason.DECODE_FAILED);
  }

  /**
   * The newest synthesis of a brush holds its best planes: children hung on any of its deliveries
   * (e.g. the [0,2) sketch before this retouch) are redone on it. Older deliveries of the same
   * brush don't cascade, so a retouch costs one pass per level, not one per delivery.
   */
  private resynthesizeChildren(parentDelivery: number): void {
    const parent = this.book.byDelivery.get(parentDelivery);
    if (!parent?.planes) return;
    const siblings = this.sameBrush(parent);
    if (siblings.some((s) => s.delivery > parent.delivery)) return;
    const children = siblings.flatMap((s) => [...(this.book.childrenOf.get(s.delivery) ?? [])]);
    for (const childId of children) {
      const child = this.book.byDelivery.get(childId);
      if (!child?.bands || child.epoch < parent.epoch || this.pending.has(childId)) continue; // flushPending sends those
      if (this.sameBrush(child).some((s) => s.delivery > child.delivery)) continue; // the newer one decodes these bands too
      const { stratum, bx, by } = splitBrushId(child.brushId);
      const req: SynthRequest = {
        delivery: child.delivery, synthesisId: this.nextSynthesisId++, stratum, qY: child.qY ?? 0, qC: child.qC ?? 0,
        seed: stratum === SEED_STRATUM, seedWidth: this.seedWidth, seedHeight: this.seedHeight,
        brush: brushKey(child.brushId, child.edition), edition: child.edition,
        bands: this.brushBands(child),
      };
      this.withParent(req, parent, bx, by);
      child.pending = true;
      this.enqueue(req, child.brushId, child.epoch);
    }
  }

  /** Spec 7.3: the same brush of a newer edition is on screen, so the older edition's deliveries go (SOLTAR 7). */
  private replaceOlderEditions(rec: DeliveryRecord): void {
    const old = [...this.book.byDelivery.values()].filter((r) => r.brushId === rec.brushId && r.edition < rec.edition);
    for (const r of old) {
      const [held, max] = [this.book.byDelivery.size, this.maxBrushes()];
      this.departures.note(brushKey(r.brushId, r.edition), 'replaced', r.delivery, performance.now(), held, max);
      this.settlement.mark(r.delivery);
      r.rgba?.close();
      this.origin.delete(brushKey(r.brushId, r.edition));
      this.book.byDelivery.delete(r.delivery);
      this.book.inFlight.delete(r.delivery);
      this.activeSynthesis.delete(r.delivery);
      this.pending.delete(r.delivery);
      this.unlink(r.delivery);
    }
    if (old.length > 0) {
      this.revision++;
      this.release(old.map((r) => r.delivery), ReleaseReason.REPLACED);
    }
  }

  private notifyPaint(): void {
    this.repaint();
  }

  applyPlanCanceladas(ranges: number[]): void {
    for (const n of ranges) {
      this.cancelled.add(n);
      this.settle(n);
      const brushId = this.book.byDelivery.get(n)?.brushId;
      this.removeSubtree(n, 0, 'cancelled');
      if (brushId !== undefined) {
        for (const [delivery, item] of this.pending) {
          if (item.parentId === brushId) this.removeSubtree(delivery, 0, 'cancelled');
        }
      }
    }
  }

  /**
   * RASPAR (spec 4.2.4), synchronously before the next control frame: (a) the predicate
   * frees what is held ≤ N now; (b) late ≤ N arrivals it covers are dropped on arrival;
   * (c)(d) RASPADO waits until every number ≤ N is settled, after the pending SOLTAR.
   */
  applyScrape(r: Scrape, now: () => number): void {
    const pending: PendingScrape = { ...r, scraped: 0, kib: 0 };
    for (const [n, rec] of [...this.book.byDelivery]) {
      if (n > r.through || !this.book.byDelivery.has(n) || !this.matchesScrape(rec, r.predicate, r.params)) continue;
      for (const id of [n, ...this.descendants(n)]) {
        const held = this.book.byDelivery.get(id);
        if (held) {
          pending.kib += toKib(held.bytes);
          pending.scraped += 1;
        }
      }
      this.removeSubtree(n, 0, 'scraped');
    }
    this.scrapes.push(pending);
    this.lastScrape = { through: r.through, epoch: r.epoch };
    if (r.predicate === ScrapePredicate.ALL) this.withdrawn = true; // spec 7.4: ERROR 4 follows the RASPADO
    this.sweepExpiry(now);
    this.answerScrapes();
  }

  /** RASPADO for every pending order whose range is settled, in order (spec 4.2.5). */
  private answerScrapes(): void {
    while (this.scrapes.length > 0) {
      const r = this.scrapes[0]!;
      if (!this.settlement.settledThrough(r.through, (n) => this.book.byDelivery.has(n))) return;
      this.scrapes.shift();
      this.flushRelease(); // SOLTAR first: RASPADO depends on the count
      const keep = ownedDeliveries(this.book).filter((n) => n <= r.through);
      this.client()?.sendScraped(this.handle, r.order, r.epoch, r.through, r.scraped, r.kib, keep);
    }
  }

  private settle(n: number): void {
    this.settlement.mark(n);
    this.answerScrapes();
  }

  /** CONCESION: checks use it from now on; deliveries that waited for its epoch go in. */
  concede(g: Grant): void {
    this.grant = g;
    const early = this.early;
    this.early = [];
    for (const run of early) run();
  }

  /**
   * PLAN INICIO for MIRADA `gazeSeq`: after a resume, numbers below `first` that never came are
   * gone; views before that MIRADA stop being painted once every number below `first` settles.
   */
  planStart(first: number, gazeSeq = 0): void {
    this.settlement.planStart(first);
    this.cones.planStart(gazeSeq, first);
    this.answerScrapes();
  }

  /** REANUDAR accepted: the old connection's in-flight numbers will never arrive; RASPAR are re-sent. */
  resumed(): void {
    this.settlement.resume();
    this.scrapes = [];
  }

  /** Spec 5.4: why this arrival cannot be held (the check, and what it found), or null. */
  private refuse(rec: DeliveryRecord, bytes: number): [string, string] | null {
    const g = this.grant;
    if (g !== null) {
      if (rec.stratum < g.minStratum || (rec.stratum === g.minStratum && rec.through > g.maxBands)) {
        return ['concession', `the concession allows stratum ${g.minStratum} with ${g.maxBands} bands at best, a server fault`];
      }
      const s = this.lastScrape;
      if (s !== null && rec.delivery > s.through && rec.epoch < s.epoch) {
        return ['epoch', `epoch ${rec.epoch} is older than the scrape of epoch ${s.epoch}, a server fault`];
      }
    }
    const fits = (): boolean => this.book.byDelivery.size < this.maxBrushes()
      && ownedBytes(this.book) + bytes <= this.maxKiB() * BYTES_PER_KIB;
    if (!fits()) this.relieve(); // at capacity the pressure trigger holds: make room first (spec 5.2.3)
    if (!fits()) {
      return ['capacity', `${this.book.byDelivery.size} of ${this.maxBrushes()} brushes and `
        + `${toKib(ownedBytes(this.book))} of ${this.maxKiB()} KiB held, a server fault`];
    }
    if (g === null || rec.stratum >= SEED_STRATUM) return null;
    const { bx, by } = splitBrushId(rec.brushId);
    const seed = makeBrushId(SEED_STRATUM, 0, 0);
    const parentId = parentBrushId(rec.stratum, bx, by, this.top);
    let held = 0;
    for (const p of this.book.byDelivery.values()) {
      if (p.brushId === parentId && p.edition === rec.edition) held = parentId === seed ? 4 : Math.max(held, p.through);
    }
    if (held >= rec.through || !this.settlement.settledBelow(rec.delivery, (n) => this.book.byDelivery.has(n))) {
      return null; // parent held with ≥ b1 bands, or still on its way: the child waits for it
    }
    return ['parent', this.departures.parentMissing(brushKey(parentId, rec.edition), held, rec.through, performance.now())];
  }

  applyRenew(ranges: number[], order: number, leaseS: number, now: () => number): void {
    this.renewThrough = Math.max(this.renewThrough, order);
    const t = now() + leaseS * MS_PER_S;
    for (const n of ranges) {
      const rec = this.book.byDelivery.get(n);
      if (rec) rec.expires = t;
    }
    this.flushReceipt();
  }

  inventory(through: number): { brushCount: number; kib: number; ranges: number[] } {
    this.sweepExpiry(() => performance.now());
    this.flushRelease();
    const ranges = ownedDeliveries(this.book).filter((n) => n <= through);
    return { brushCount: new Set([...this.book.byDelivery.values()].map((r) => r.brushId.toString())).size, kib: toKib(ownedBytes(this.book)), ranges };
  }

  /**
   * Spec 5.2.2, before each paint and with each incoming message (never on a timer): nothing
   * expired is painted. Free until the earliest lease in the book ends.
   */
  checkExpiry(now: number): void {
    if (now >= this.nextExpiry) this.sweepExpiry(() => now);
  }

  sweepExpiry(now: () => number): void {
    const t = now();
    const expired = [...this.book.byDelivery.entries()]
      .filter(([, rec]) => this.effectiveExpiry(rec) <= t)
      .map(([n]) => n);
    for (const n of expired) {
      if (!this.book.byDelivery.has(n)) continue;
      const removed = this.removeSubtree(n, 0, 'expired');
      this.expiredQueue.push(...removed);
    }
    this.nextExpiry = Infinity; // min over the book of vence = min of vence_efectivo
    for (const rec of this.book.byDelivery.values()) this.nextExpiry = Math.min(this.nextExpiry, rec.expires);
    if (this.expiredQueue.length > 0 && this.releaseTimer === 0) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = 0;
        const q = this.expiredQueue;
        this.expiredQueue = [];
        this.release(q, ReleaseReason.EXPIRED);
      }, RELEASE_BATCH_MS) as unknown as number;
    }
  }

  /**
   * The view the last MIRADA (numbered `seq`) described, image px. Moving away is what makes old
   * brushes evictable, once the old view's flows have landed; if that frees room, a RECIBO tells
   * the server the window reopened.
   */
  setView(x0: number, y0: number, x1: number, y1: number, vw: number, vh: number, seq = 0): void {
    const nowS = performance.now() / MS_PER_S;
    const zoom = Math.log2(Math.max((x1 - x0) / Math.max(1, vw), (y1 - y0) / Math.max(1, vh)));
    const ideal = Number.isFinite(zoom) ? zoom : 0;
    const focus = clamp(Math.floor(ideal), 0, this.top - 1);
    this.warmShown(nowS);
    this.view = { x0, y0, x1, y1, focus };
    this.cones.look(this.view, seq);
    this.viewSince = nowS;
    this.gaze.observe(nowS, (x0 + x1) / 2, (y0 + y1) / 2, ideal, Math.hypot(x1 - x0, y1 - y0) / 2);
    if (this.relieve()) this.flushReceipt();
  }

  /** Attention heat: the brushes the outgoing view showed are credited the time it stayed on screen. */
  private warmShown(nowS: number): void {
    const v = this.view;
    if (!v) return;
    const dwell = nowS - this.viewSince;
    for (const [key, recs] of ownedBrushes(this.book)) {
      if (inCore(v, recs[0]!.brushId)) this.heat.warm(key, dwell, nowS);
    }
  }

  /**
   * §5.2.3 voluntary eviction. Under pressure (owned + in flight ≥ max − 8, bytes > 90 %, or room
   * in max_kib for fewer than 8 more after what may still come) drop leaf brushes — no owned
   * children — until 75 % full with room for 8. Never the sketch nor the core, and
   * not a cone the server may still be painting unless the book is full (see
   * `collectCandidates`). Order is Horizon (`rankHorizon`): the largest predicted time-to-need
   * from the gaze's motion (kinematic Bélády), shortened by attention heat.
   * Whole brushes go, all deliveries at once, with SOLTAR reason 1.
   */
  private relieve(vramShort = false): boolean {
    const load = (): number => this.book.byDelivery.size + this.book.inFlight.size;
    // A failed VRAM reservation is pressure whatever the counts say: relieve to 75 % of what is held.
    const maxN = vramShort ? Math.min(this.maxBrushes(), load()) : this.maxBrushes();
    const maxB = (vramShort ? Math.min(this.maxKiB() * BYTES_PER_KIB, ownedBytes(this.book)) : this.maxKiB() * BYTES_PER_KIB);
    // The byte window closes RECIBO.libre (`free`): pressure must see it too, or the view stalls at 0.
    const cramped = (): boolean => !vramShort && this.byteWindow() < EVICT_HEADROOM;
    if (!vramShort && !cramped() && load() < maxN - EVICT_HEADROOM && ownedBytes(this.book) <= EVICT_PRESSURE * maxB) {
      return false;
    }
    const sketch = Math.min(SKETCH_MIN, Math.max(0, this.top - 1));
    const nowS = performance.now() / MS_PER_S;
    const gaze = this.gaze.state(nowS);
    const heatOf = (key: string): number => this.heat.heat(key, nowS);
    const released: number[] = [];
    const over = (): boolean => cramped() || load() > EVICT_TARGET * maxN || ownedBytes(this.book) > EVICT_TARGET * maxB;
    // The server opens a flow only while |libro| < max_pinceladas (§4.1 c), so with the book full
    // nothing is on the wire: only the core stays (§5.2.3), and a cone larger than the
    // concession cannot stall the view with nothing evictable. Bytes do not stop the server: a cone
    // it may still paint keeps its parents, or its children arrive to find them gone (spec 5.4).
    const painted = this.book.byDelivery.size >= this.maxBrushes() ? []
      : this.cones.views((n) => this.settlement.settledBelow(n, (m) => this.book.byDelivery.has(m)));
    while (over()) {
      const candidates = collectCandidates(this.book, this.view, painted, sketch);
      if (candidates.length === 0) break;
      for (const { recs } of rankHorizon(candidates, gaze, heatOf)) {
        if (!over()) break;
        for (const r of recs) if (this.book.byDelivery.has(r.delivery)) released.push(...this.removeSubtree(r.delivery, 0, 'evicted'));
      }
    }
    if (released.length > 0) this.heat.prune(new Set(ownedBrushes(this.book).keys()));
    this.release(released, ReleaseReason.EVICTED);
    return released.length > 0;
  }

  /**
   * §5.2.3's third trigger: the renderer could not reserve texture memory for new brushes.
   * Same eviction as under count/byte pressure (Horizon order, leaves only, SOLTAR 1).
   */
  reportVramFailure(): void {
    if (this.relieve(true)) this.flushReceipt();
  }

  /**
   * RECIBO.libre: the memory window (brushes and max_kib), capped to ~CREDIT_WINDOW_S of deliveries at the link's
   * recent rate, so a slow link never queues more than that ahead of a new MIRADA.
   */
  free(): number {
    const memory = clamp(this.maxBrushes() - this.book.byDelivery.size, 0, this.byteWindow());
    const peak = this.client()?.meter?.peak(performance.now()) ?? 0;
    // Only a second that carried at least one brush measures the link; idle keeps the last rate,
    // so the next view starts with a full window instead of re-ramping from CREDIT_MIN.
    if (this.avgDelivery > 0 && peak >= this.avgDelivery) this.linkBps = peak;
    return receiverWindow(memory, this.linkBps, this.avgDelivery);
  }

  /** Deliveries that still fit in max_kib after what may arrive before the server reads the next RECIBO. */
  private byteWindow(): number {
    const room = byteRoom(this.maxKiB() * BYTES_PER_KIB - ownedBytes(this.book), this.largest, this.avgDelivery);
    return room - coming(Math.max(0, this.lastFree), this.book.pendingReceipt.length);
  }

  get queueDepthMs(): number {
    return this.decode.ms;
  }

  /** Pool observability for telemetry: size, busy workers, queued jobs. */
  get synthLoad(): { size: number; busy: number; waiting: number } {
    return { size: this.pool?.size ?? 0, busy: this.pool?.busyCount() ?? 0, waiting: this.ready.size };
  }

  get avgDeliveryBytes(): number {
    return this.avgDelivery;
  }

  private release(ranges: number[], reason: number): void {
    if (ranges.length === 0) return;
    this.client()?.sendRelease(this.handle, reason, [...ranges].sort((a, b) => a - b));
  }

  private effectiveExpiry(rec: DeliveryRecord): number {
    const parentId = this.book.parentOf.get(rec.delivery);
    const parent = parentId === undefined ? null : this.book.byDelivery.get(parentId);
    return effectiveExpiry(rec, parent ? this.effectiveExpiry(parent) : null);
  }

  /** Spec §5.2: SOLTAR must precede anything account-dependent (RASPADO/INVENTARIO). */
  private flushRelease(): void {
    if (this.expiredQueue.length === 0) return;
    if (this.releaseTimer !== 0) {
      clearTimeout(this.releaseTimer);
      this.releaseTimer = 0;
    }
    const q = this.expiredQueue;
    this.expiredQueue = [];
    this.release(q, ReleaseReason.EXPIRED);
  }

  private maybeFlushReceipt(): void {
    // A small window (slow link) is refilled per brush so the link never drains; big ones batch.
    if (this.book.pendingReceipt.length >= RECEIPT_EVERY_N || this.free() <= RECEIPT_EVERY_N) {
      this.flushReceipt();
      return;
    }
    if (this.receiptTimer === 0 && this.book.pendingReceipt.length > 0) {
      this.receiptTimer = setTimeout(() => {
        this.receiptTimer = 0;
        this.flushReceipt();
      }, RECEIPT_EVERY_MS) as unknown as number;
    }
  }

  private flushReceipt(): void {
    this.flushRelease();
    this.relieve(); // §5.2.3: SOLTAR motivo 1 goes out before anything that depends on the count
    const q = this.book.pendingReceipt;
    const free = this.free();
    const queue = Math.round(this.decode.ms);
    // Nothing the server acts on changed: no new receipts, window, backlog or renewal to confirm.
    if (q.length === 0 && free === this.lastFree && queue === this.lastQueue && this.renewThrough === this.lastRenew) return;
    this.book.pendingReceipt = [];
    this.lastFree = free;
    this.lastQueue = queue;
    this.lastRenew = this.renewThrough;
    for (const n of q) this.book.inFlight.delete(n);
    for (const n of q) {
      const rec = this.book.byDelivery.get(n);
      if (rec) {
        rec.receiptQueued = false;
        rec.receiptSent = true;
      }
    }
    this.client()?.sendReceipt(this.handle, [...q].sort((a, b) => a - b), queue, free, this.renewThrough);
  }

  matchesScrape(rec: DeliveryRecord, predicate: number, params: Uint8Array): boolean {
    return scrapeMatches(rec, predicate, params);
  }

  dispose(): void {
    clearTimeout(this.receiptTimer);
    clearTimeout(this.releaseTimer);
    this.pool?.dispose();
    this.pool = null;
    this.ready.clear();
    this.pending.clear();
    this.activeSynthesis.clear();
    this.inflight.clear();
    this.origin.clear();
    this.failed.clear();
    for (const rec of this.book.byDelivery.values()) rec.rgba?.close();
    this.book = emptyLedger();
    this.revision++;
  }
}
