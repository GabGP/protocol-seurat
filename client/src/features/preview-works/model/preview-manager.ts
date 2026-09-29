import { parseBrushHead, sliceBands, splitBrushId, verifyBand, type BrushHead } from '@/shared/proto/brush';
import { dropWorkPreview, previewWidth } from '@/entities/work/previews';
import type { WorkerFactory } from '@/entities/delivery/worker-pool';
import { LEASE_S, MS_PER_S, PREVIEW_CREDIT, PREVIEW_GAZE_KEEPALIVE_MS, PREVIEW_OPENS, ReleaseReason } from '@/shared/config/constants';
import type { Audit, Renew, Scrape, WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/app/providers/session-client';
import type { PreviewLoan } from './preview-loan';
import { piecesKib, type PreviewPiece } from './preview-piece';
import { gazeLevel, previewGaze, type PreviewGaze } from './preview-gaze';
import { PreviewDecoder } from './preview-decoder';
import { PreviewOpens } from './preview-opens';
import { PreviewPainter } from './preview-painter';

/**
 * Catalog thumbnails inside the protocol (spec 3.2): each card is a canvas with its own MIRADA,
 * the whole work at the card's device pixels, so the server's cone decides how deep it paints
 * (spec 2.2). Its pieces are loans like any other; anything finer than the card needs is released
 * at once. RENOVAR / RASPAR / AUDITAR are answered, the MIRADA is repeated inside the inactivity
 * floor, and CERRAR (leaving the gallery) or an unrenewed seed drops the thumbnail. A few works
 * are opened and composed at once (PREVIEW_OPENS), in the gallery's order.
 */
export class PreviewManager {
  private readonly opens = new PreviewOpens((loan) => this.giveUp(loan));
  private held = new Map<number, PreviewLoan>();
  private paused = false;
  private readonly painter: PreviewPainter;
  /** MIRADA seq, rising across every card. */
  private gazeSeq = 0;

  constructor(private client: () => SessionClient | null, workers?: WorkerFactory) {
    const live = (loan: PreviewLoan): boolean => this.held.get(loan.handle) === loan;
    this.painter = new PreviewPainter(new PreviewDecoder(workers), live, () => this.pump());
  }

  enqueue(ids: string[]): void {
    this.opens.enqueue(ids);
    this.pump();
  }

  /** A work is opened for viewing: every preview canvas is closed (CERRAR releases all of it). */
  pause(): void {
    this.paused = true;
    const all = [...this.held.values(), ...this.opens.drain()];
    for (const l of all) this.close(l);
    this.painter.dispose();
    // Back in the gallery, the same thumbnails are fetched again (not kept meanwhile).
    this.opens.requeueFirst(all.map((l) => l.id));
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  owns(handle: number): boolean {
    return this.held.has(handle) || this.opens.byHandle(handle) !== undefined;
  }

  onWorkOpened(id: string, a: WorkOpened): void {
    const opening = this.opens.byId(id);
    if (!opening) {
      this.client()?.closeHandle(a.handle);
      return;
    }
    const loan = Object.assign(opening, {
      handle: a.handle, seedW: a.seedWidth, seedH: a.seedHeight, top: a.strata - 1, workW: a.width, workH: a.height, vw: previewWidth(),
    });
    if (loan.top > 0) loan.level = gazeLevel(this.gaze(loan, performance.now()), loan.top);
  }

  onDelivery(bytes: Uint8Array): boolean {
    let h: BrushHead;
    let bands: Uint8Array[];
    try {
      h = parseBrushHead(bytes);
      bands = sliceBands(bytes, h);
    } catch {
      return false;
    }
    const loan = this.opens.byHandle(h.handle) ?? this.held.get(h.handle);
    if (!loan) return false;
    const { bx, by } = splitBrushId(h.brushId);
    if (!loan.wants(h, bx, by)) return this.release(loan, ReleaseReason.EVICTED, [h.delivery]); // finer than the card needs, or held already
    if (bands.some((b, i) => !verifyBand(b, h.crcs[i] ?? 0))) return this.release(loan, ReleaseReason.CRC, [h.delivery]);
    const piece: PreviewPiece = { ...h, bx, by, bands, expires: performance.now() + LEASE_S * MS_PER_S };
    this.release(loan, ReleaseReason.REPLACED, loan.take(piece).map((p) => p.delivery));
    this.client()?.sendReceipt(loan.handle, [h.delivery], 0, PREVIEW_CREDIT, 0);
    if (loan.seed && this.opens.done(loan)) this.held.set(loan.handle, loan);
    if (loan.seed) this.painter.draw(loan);
    return true;
  }

  onRenew(r: Renew): boolean {
    const loan = this.held.get(r.handle);
    if (!loan) return false;
    loan.renew(r.ranges, r.leaseS, performance.now());
    loan.renewThrough = Math.max(loan.renewThrough, r.order);
    this.client()?.sendReceipt(loan.handle, [], 0, PREVIEW_CREDIT, loan.renewThrough);
    return true;
  }

  onScrape(r: Scrape): boolean {
    const loan = this.held.get(r.handle) ?? this.opens.byHandle(r.handle);
    if (!loan) return false;
    const { scraped, kept } = loan.scrape(r);
    this.client()?.sendScraped(r.handle, r.order, r.epoch, r.through, scraped.length, piecesKib(scraped), kept);
    if (scraped.length > 0) this.painter.redraw(loan);
    return true;
  }

  onAudit(a: Audit): boolean {
    const loan = this.held.get(a.handle);
    if (!loan) return false;
    const held = loan.pieces().filter((p) => p.delivery <= a.through);
    this.client()?.sendInventory(a.handle, a.order, a.through, held.length, piecesKib(held), loan.numbersThrough(a.through));
    return true;
  }

  /**
   * Spec 5.2.2: pieces whose lease ran out are released (SOLTAR CADUCADA); without its seed the
   * canvas closes. Each card still showing looks at its work again before the server floors it.
   */
  sweep(now: number): void {
    for (const loan of this.held.values()) {
      if (loan.top > 0 && now - loan.gazedAt >= PREVIEW_GAZE_KEEPALIVE_MS) this.gaze(loan, now);
    }
    for (const loan of [...this.held.values()]) {
      const gone = loan.expired(now);
      if (gone.length === 0) continue;
      this.release(loan, ReleaseReason.EXPIRED, gone.map((p) => p.delivery));
      loan.remove(gone);
      if (loan.seed) this.painter.redraw(loan);
      else this.close(loan);
    }
  }

  onError(id: string): void {
    const loan = this.opens.byId(id);
    if (loan) this.giveUp(loan);
  }

  dispose(): void {
    this.pause();
    this.opens.clear();
  }

  private gaze(loan: PreviewLoan, now: number): PreviewGaze {
    loan.gazedAt = now;
    const g = previewGaze(loan, loan.workW, loan.workH, ++this.gazeSeq);
    this.client()?.sendGazeReliable(g);
    return g;
  }

  private release(loan: PreviewLoan, reason: number, numbers: number[]): true {
    if (numbers.length > 0) this.client()?.sendRelease(loan.handle, reason, numbers);
    return true;
  }

  /** A work that could not be opened, or brought no seed in time: its card keeps its placeholder. */
  private giveUp(loan: PreviewLoan): void {
    this.close(loan);
    this.pump();
  }

  private close(loan: PreviewLoan): void {
    this.opens.done(loan);
    this.held.delete(loan.handle);
    this.painter.forget(loan);
    dropWorkPreview(loan.id);
    if (loan.handle > 0) this.client()?.closeHandle(loan.handle);
  }

  /** Opens queued works while fewer than PREVIEW_OPENS are being opened or composed. */
  private pump(): void {
    if (this.paused) return;
    for (const loan of this.opens.start(PREVIEW_OPENS - this.painter.busy)) this.client()?.openPreview(loan.id);
  }
}
