import {
  EVICT_HEADROOM, EVICT_PRESSURE, EVICT_TARGET, RECEIPT_EVERY_N, RECEIPT_EVERY_MS, RELEASE_BATCH_MS, SKETCH_MIN, TILE,
} from '@/shared/config/constants';
import { receiverWindow } from '@/entities/delivery/credit';
import { DecodeQueue } from '@/entities/delivery/decode-queue';
import { AttentionHeat } from '@/entities/delivery/attention-heat';
import { collectCandidates, inCore, ownedBrushes, type EvictView } from '@/entities/delivery/evict-candidate';
import { GazeMotion } from '@/entities/delivery/gaze-motion';
import { rankHorizon } from '@/entities/delivery/horizon-rank';
import { SynthQueue, type ReadyJob } from '@/entities/delivery/synth-queue';
import { WorkerPool, defaultWorker, resolvePoolSize, type WorkerFactory } from '@/entities/delivery/worker-pool';
import { makeBrushId, brushKey, parseBrushHead, splitBrushId, sliceBands, verifyBand } from '@/shared/proto/brush';
import type { Scrape } from '@/shared/proto/messages';
import { matchesScrape as scrapeMatches } from '@/entities/delivery/scrape';
import { effectiveExpiry, emptyLedger, ownedBytes, ownedDeliveries, type DeliveryLedger, type DeliveryRecord } from '@/entities/delivery/store';
import { STALE_PARENT, type SynthRequest, type SynthResult } from '@/workers/protocol';
import type { SessionClient } from './session-client';

/** cola_ms from which the server caps or stops plans (ConePlanner: 150 / 400). */
const COLA_BUSY_MS = 150;

interface PendingScrape {
  order: number;
  epoch: number;
  through: number;
  predicate: number;
  params: Uint8Array;
}

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
  private readonly decode = new DecodeQueue();
  private scrapes: PendingScrape[] = [];
  private cancelled = new Set<number>();
  private settledBelow: number | null = null;
  private avgDelivery = 0;
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
    this.failed.delete(h.delivery);
    if (this.settledBelow !== null && h.delivery <= this.settledBelow) {
      const probe: DeliveryRecord = {
        delivery: h.delivery, brushId: h.brushId, stratum: Number((h.brushId >> 56n) & 0xffn),
        from: h.from, through: h.through, bytes: 0, epoch: h.epoch, edition: h.edition, expires: 0, rgba: null,
      };
      if (this.scrapes.some((p) => h.delivery <= p.through && this.matchesScrape(probe, p.predicate, p.params))) return;
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
        this.release([h.delivery], 6);
        return;
      }
    }
    const total = bands.reduce((n, b) => n + b.length, 0);
    this.avgDelivery = this.avgDelivery === 0 ? bytes.length : 0.8 * this.avgDelivery + 0.2 * bytes.length;
    const split = splitBrushId(h.brushId);
    const retainedBands = bands.map((band) => band.slice().buffer);
    const rec: DeliveryRecord = {
      delivery: h.delivery,
      brushId: h.brushId,
      stratum: split.stratum,
      from: h.from,
      through: h.through,
      bytes: total,
      epoch: h.epoch,
      edition: h.edition,
      expires: now() + leaseS * 1000,
      rgba: null,
      bands: retainedBands,
      planes: null,
      qY: h.qY,
      qC: h.qC,
      pending: true,
      receiptQueued: false,
      receiptSent: false,
    };
    this.book.byDelivery.set(h.delivery, rec);
    this.book.inFlight.add(h.delivery);
    this.revision++;
    const req: SynthRequest = {
      delivery: h.delivery,
      synthesisId: this.nextSynthesisId++,
      stratum: split.stratum,
      qY: h.qY,
      qC: h.qC,
      seed: split.stratum === 10,
      seedWidth: this.seedWidth,
      seedHeight: this.seedHeight,
      brush: brushKey(h.brushId, h.edition),
      edition: h.edition,
      bands: this.brushBands(rec),
    };
    const parent = this.parentFor(split.stratum, split.bx, split.by, h.edition, h.epoch);
    if (parent) this.linkParent(h.delivery, parent.delivery);
    if (parent?.planes) this.withParent(req, parent, split.bx, split.by);
    if (split.stratum < 10 && !parent?.planes) {
      const isCoarsest = split.stratum + 1 >= this.top;
      const parentId = isCoarsest
        ? makeBrushId(10, 0, 0)
        : makeBrushId(split.stratum + 1, split.bx >> 1, split.by >> 1);
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
    if (stratum >= 10) return null;
    const isCoarsest = stratum + 1 >= this.top;
    const parentId = isCoarsest
      ? makeBrushId(10, 0, 0)
      : makeBrushId(stratum + 1, bx >> 1, by >> 1);
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
    const seed = parent.stratum === 10;
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

  private removeSubtree(root: number, reason: number): number[] {
    const all = [root, ...this.descendants(root)];
    const removed = new Set(all);
    this.book.pendingReceipt = this.book.pendingReceipt.filter((n) => !removed.has(n));
    for (const n of all) {
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
    const removed = this.removeSubtree(delivery, 0);
    this.release(removed, 2);
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
        seed: stratum === 10, seedWidth: this.seedWidth, seedHeight: this.seedHeight,
        brush: brushKey(child.brushId, child.edition), edition: child.edition,
        bands: this.brushBands(child),
      };
      this.withParent(req, parent, bx, by);
      child.pending = true;
      this.enqueue(req, child.brushId, child.epoch);
    }
  }

  private notifyPaint(): void {
    this.repaint();
  }

  applyPlanCanceladas(ranges: number[]): void {
    for (const n of ranges) {
      this.cancelled.add(n);
      const brushId = this.book.byDelivery.get(n)?.brushId;
      this.removeSubtree(n, 0);
      if (brushId !== undefined) {
        for (const [delivery, item] of this.pending) {
          if (item.parentId === brushId) this.removeSubtree(delivery, 0);
        }
      }
    }
  }

  applyScrape(r: Scrape, now: () => number): void {
    void now;
    this.scrapes.push({ order: r.order, epoch: r.epoch, through: r.through, predicate: r.predicate, params: r.params });
    let scrapedCount = 0;
    let kib = 0;
    for (const [n, rec] of [...this.book.byDelivery]) {
      if (n > r.through) continue;
      if (this.matchesScrape(rec, r.predicate, r.params)) {
        const subtree = [n, ...this.descendants(n)];
        for (const id of subtree) {
          const child = this.book.byDelivery.get(id);
          if (child) {
            kib += Math.ceil(child.bytes / 1024);
            scrapedCount += 1;
          }
        }
        this.removeSubtree(n, 0);
      }
    }
    this.flushRelease();
    const keep = ownedDeliveries(this.book).filter((n) => n <= r.through);    this.client()?.sendScraped(this.handle, r.order, r.epoch, r.through, scrapedCount, kib, keep);
    this.settledBelow = this.settledBelow === null ? r.through : Math.max(this.settledBelow, r.through);
    this.scrapes = this.scrapes.filter((p) => p.through > r.through);
  }

  applyRenew(ranges: number[], order: number, leaseS: number, now: () => number): void {
    this.renewThrough = Math.max(this.renewThrough, order);
    const t = now() + leaseS * 1000;
    for (const n of ranges) {
      const rec = this.book.byDelivery.get(n);
      if (rec) rec.expires = t;
    }
    this.flushReceipt();
  }

  inventory(through: number): { brushCount: number; kib: number; ranges: number[] } {
    this.flushRelease();
    const ranges = ownedDeliveries(this.book).filter((n) => n <= through);
    return { brushCount: new Set([...this.book.byDelivery.values()].map((r) => r.brushId.toString())).size, kib: Math.ceil(ownedBytes(this.book) / 1024), ranges };
  }

  sweepExpiry(now: () => number): void {
    const t = now();
    const expired = [...this.book.byDelivery.entries()]
      .filter(([, rec]) => this.effectiveExpiry(rec) <= t)
      .map(([n]) => n);
    for (const n of expired) {
      if (!this.book.byDelivery.has(n)) continue;
      const removed = this.removeSubtree(n, 0);
      this.expiredQueue.push(...removed);
    }
    if (this.expiredQueue.length > 0 && this.releaseTimer === 0) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = 0;
        const q = this.expiredQueue;
        this.expiredQueue = [];
        this.release(q, 3);
      }, RELEASE_BATCH_MS) as unknown as number;
    }
  }

  /**
   * The view the last MIRADA described (image px). Moving away is what makes old brushes
   * evictable; if that frees room, a RECIBO tells the server the window reopened.
   */
  setView(x0: number, y0: number, x1: number, y1: number, vw: number, vh: number): void {
    const nowS = performance.now() / 1000;
    const zoom = Math.log2(Math.max((x1 - x0) / Math.max(1, vw), (y1 - y0) / Math.max(1, vh)));
    const ideal = Number.isFinite(zoom) ? zoom : 0;
    const focus = Math.max(0, Math.min(this.top - 1, Math.floor(ideal)));
    this.warmShown(nowS);
    this.view = { x0, y0, x1, y1, focus };
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
   * §5.2.3 voluntary eviction. Under pressure (owned + in flight ≥ max − 8, or bytes > 90 %)
   * drop leaf brushes — no owned children — until 75 % full. Never the sketch nor the cone's
   * core (see `collectCandidates`). Order is Horizon (`rankHorizon`): the largest predicted
   * time-to-need from the gaze's motion (kinematic Bélády), shortened by attention heat.
   * Whole brushes go, all deliveries at once, with SOLTAR reason 1.
   */
  private relieve(vramShort = false): boolean {
    const load = (): number => this.book.byDelivery.size + this.book.inFlight.size;
    // A failed VRAM reservation is pressure whatever the counts say: relieve to 75 % of what is held.
    const maxN = vramShort ? Math.min(this.maxBrushes(), load()) : this.maxBrushes();
    const maxB = (vramShort ? Math.min(this.maxKiB() * 1024, ownedBytes(this.book)) : this.maxKiB() * 1024);
    if (!vramShort && load() < maxN - EVICT_HEADROOM && ownedBytes(this.book) <= EVICT_PRESSURE * maxB) return false;
    const sketch = Math.min(SKETCH_MIN, Math.max(0, this.top - 1));
    const nowS = performance.now() / 1000;
    const gaze = this.gaze.state(nowS);
    const heatOf = (key: string): number => this.heat.heat(key, nowS);
    const released: number[] = [];
    const over = (): boolean => load() > EVICT_TARGET * maxN || ownedBytes(this.book) > EVICT_TARGET * maxB;
    while (over()) {
      const candidates = collectCandidates(this.book, this.view, sketch);
      if (candidates.length === 0) break;
      for (const { recs } of rankHorizon(candidates, gaze, heatOf)) {
        if (!over()) break;
        for (const r of recs) if (this.book.byDelivery.has(r.delivery)) released.push(...this.removeSubtree(r.delivery, 0));
      }
    }
    if (released.length > 0) this.heat.prune(new Set(ownedBrushes(this.book).keys()));
    this.release(released, 1);
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
   * RECIBO.libre: the memory window, capped to ~CREDIT_WINDOW_S of deliveries at the link's
   * recent rate, so a slow link never queues more than that ahead of a new MIRADA.
   */
  free(): number {
    const memory = Math.max(0, this.maxBrushes() - this.book.byDelivery.size);
    const peak = this.client()?.meter?.peak(performance.now()) ?? 0;
    // Only a second that carried at least one brush measures the link; idle keeps the last rate,
    // so the next view starts with a full window instead of re-ramping from CREDIT_MIN.
    if (this.avgDelivery > 0 && peak >= this.avgDelivery) this.linkBps = peak;
    return receiverWindow(memory, this.linkBps, this.avgDelivery);
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
    this.release(q, 3);
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
