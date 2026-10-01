import { splitBrushId } from '@/shared/proto/brush';
import { dropWorkPreview, previewWidth } from '@/entities/work';
import type { WorkerFactory } from '@/entities/delivery';
import { PREVIEW_OPENS, ReleaseReason } from '@/shared/config/constants';
import type { Audit, Renew, Scrape, WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/entities/session';
import type { PreviewLoan } from './preview-loan';
import { bandsIntact, readDelivery, type PreviewPiece } from './preview-piece';
import { gazeLevel, keepGazing } from './preview-gaze';
import { PreviewReplies, leaseExpiry } from './preview-replies';
import { PreviewDecoder } from './preview-decoder';
import { PreviewOpens } from './preview-opens';
import { PreviewPainter } from './preview-painter';

/**
 * Catalog thumbnails inside the protocol (spec 3.2): each card is a canvas with its own MIRADA,
 * the whole work at the card's device pixels, so the server's cone decides how deep it paints
 * (spec 2.2). Its pieces are loans like any other; anything finer than the card needs is released
 * at once. RENOVAR / RASPAR / AUDITAR are answered, the MIRADA is repeated inside the inactivity
 * floor, and CERRAR (leaving the gallery) or an unrenewed seed drops the thumbnail. A few works
 * are opened and composed at once (PREVIEW_OPENS), only for the cards the gallery shows.
 */
export class PreviewManager {
  private readonly opens = new PreviewOpens((loan) => this.giveUp(loan));
  private held = new Map<number, PreviewLoan>();
  private paused = false;
  private readonly painter: PreviewPainter;
  private readonly replies: PreviewReplies;

  constructor(private client: () => SessionClient | null, workers?: WorkerFactory) {
    const live = (loan: PreviewLoan): boolean => this.held.get(loan.handle) === loan;
    this.painter = new PreviewPainter(new PreviewDecoder(workers), live, () => this.pump());
    this.replies = new PreviewReplies(client, this.painter);
  }

  /** The cards the gallery shows: only these hold a thumbnail, any other canvas is closed (CERRAR). */
  show(ids: string[]): void {
    const keep = new Set(ids);
    for (const loan of [...this.held.values(), ...this.opens.loans()]) if (!keep.has(loan.id)) this.close(loan);
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
    // Not shown any more, or shown again after its page was left: this ABIERTA answers a closed request.
    if (!opening || opening.handle > 0) {
      this.client()?.closeHandle(a.handle);
      return;
    }
    const loan = Object.assign(opening, {
      handle: a.handle, seedW: a.seedWidth, seedH: a.seedHeight, top: a.strata - 1, workW: a.width, workH: a.height, vw: previewWidth(),
    });
    if (loan.top > 0) loan.level = gazeLevel(this.replies.gaze(loan, performance.now()), loan.top);
  }

  onDelivery(bytes: Uint8Array): boolean {
    const read = readDelivery(bytes);
    if (!read) return false;
    const { h, bands } = read;
    const loan = this.opens.byHandle(h.handle) ?? this.held.get(h.handle);
    if (!loan) return false;
    const { bx, by } = splitBrushId(h.brushId);
    if (!loan.wants(h, bx, by)) return this.replies.release(loan, ReleaseReason.EVICTED, [h.delivery]); // finer than the card needs, or held already
    if (!bandsIntact(h, bands)) return this.replies.release(loan, ReleaseReason.CRC, [h.delivery]);
    const piece: PreviewPiece = { ...h, bx, by, bands, expires: leaseExpiry(performance.now()) };
    this.replies.release(loan, ReleaseReason.REPLACED, loan.take(piece).map((p) => p.delivery));
    this.replies.receipt(loan, h.delivery);
    if (loan.seed && this.opens.done(loan)) this.held.set(loan.handle, loan);
    if (loan.seed) this.painter.draw(loan);
    return true;
  }

  onRenew(r: Renew): boolean {
    return this.replies.renew(this.held.get(r.handle), r);
  }

  onScrape(r: Scrape): boolean {
    return this.replies.scrape(this.held.get(r.handle) ?? this.opens.byHandle(r.handle), r);
  }

  onAudit(a: Audit): boolean {
    return this.replies.audit(this.held.get(a.handle), a);
  }

  /** Spec 5.2.2: pieces whose lease ran out are released (SOLTAR CADUCADA); without its seed the canvas closes. */
  sweep(now: number): void {
    keepGazing(this.held.values(), this.replies, now);
    for (const loan of [...this.held.values()]) {
      const gone = loan.expired(now);
      if (gone.length === 0) continue;
      this.replies.release(loan, ReleaseReason.EXPIRED, gone.map((p) => p.delivery));
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
