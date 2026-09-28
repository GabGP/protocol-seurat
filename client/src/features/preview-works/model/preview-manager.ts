import { parseBrushHead, sliceBands, splitBrushId, verifyBand, type BrushHead } from '@/shared/proto/brush';
import { dropWorkPreview, hasWorkPreview, setWorkPreview } from '@/entities/work/previews';
import type { WorkerFactory } from '@/entities/delivery/worker-pool';
import { LEASE_S } from '@/shared/config/constants';
import type { Audit, Renew, Scrape, WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/app/providers/session-client';
import { PreviewLoan, piecesKib, type PreviewPiece } from './preview-loan';
import { PreviewDecoder } from './preview-decoder';
import { composePreview } from './preview-compose';

const SOLTAR_LRU = 1;
const SOLTAR_CADUCADA = 3;
const SOLTAR_CRC = 6;
const SOLTAR_REEMPLAZADA = 7;
const OPEN_TIMEOUT_MS = 5000;

/**
 * Catalog thumbnails inside the protocol (spec 3.2): the seed and the brushes of the stratum
 * under it are loans like any other. RECIBO libre = brushes still missing, so the server paints
 * exactly those and no more of the sketch; anything else is released at once. RENOVAR / RASPAR /
 * AUDITAR are answered; CERRAR (leaving the gallery) or an unrenewed seed drops the thumbnail.
 */
export class PreviewManager {
  private queue: string[] = [];
  private loading: PreviewLoan | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private held = new Map<number, PreviewLoan>();
  private paused = false;
  private readonly decoder: PreviewDecoder;
  /** Loans being composed, and those that changed meanwhile (composed once more after). */
  private drawing = new Set<PreviewLoan>();
  private stale = new Set<PreviewLoan>();

  constructor(private client: () => SessionClient | null, workers?: WorkerFactory) {
    this.decoder = new PreviewDecoder(workers);
  }

  enqueue(ids: string[]): void {
    for (const id of ids) {
      if (!hasWorkPreview(id) && !this.queue.includes(id) && this.loading?.id !== id) this.queue.push(id);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    this.queue.sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999));
    this.pump();
  }

  /** A work is opened for viewing: every preview canvas is closed (CERRAR releases all of it). */
  pause(): void {
    this.paused = true;
    const all = [...this.held.values(), ...(this.loading ? [this.loading] : [])];
    for (const l of all) this.close(l);
    this.loading = null;
    this.decoder.dispose();
    // Back in the gallery, the same thumbnails are fetched again (not kept meanwhile).
    this.queue = [...new Set([...all.map((l) => l.id), ...this.queue])];
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  owns(handle: number): boolean {
    return this.held.has(handle) || this.loading?.handle === handle;
  }

  onWorkOpened(id: string, a: WorkOpened): void {
    if (!this.loading || this.loading.id !== id) {
      this.client()?.closeHandle(a.handle);
      return;
    }
    Object.assign(this.loading, { handle: a.handle, seedW: a.seedWidth, seedH: a.seedHeight, top: a.strata - 1 });
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
    const loan = this.loading?.handle === h.handle ? this.loading : this.held.get(h.handle);
    if (!loan) return false;
    const { bx, by } = splitBrushId(h.brushId);
    if (!loan.wants(h, bx, by)) return this.release(loan, SOLTAR_LRU, [h.delivery]); // not a thumbnail piece
    if (bands.some((b, i) => !verifyBand(b, h.crcs[i] ?? 0))) return this.release(loan, SOLTAR_CRC, [h.delivery]);
    const piece: PreviewPiece = { ...h, bx, by, bands, expires: performance.now() + LEASE_S * 1000 };
    this.release(loan, SOLTAR_REEMPLAZADA, loan.take(piece).map((p) => p.delivery));
    this.client()?.sendReceipt(loan.handle, [h.delivery], 0, loan.missing(), 0);
    if (loan === this.loading && loan.seed) {
      if (this.timer) clearTimeout(this.timer);
      this.loading = null;
      this.held.set(loan.handle, loan);
    }
    if (loan.seed && (piece === loan.seed || loan.missing() === 0)) this.draw(loan);
    return true;
  }

  onRenew(r: Renew): boolean {
    const loan = this.held.get(r.handle);
    if (!loan) return false;
    loan.renew(r.ranges, r.leaseS, performance.now());
    loan.renewThrough = Math.max(loan.renewThrough, r.order);
    this.client()?.sendReceipt(loan.handle, [], 0, loan.missing(), loan.renewThrough);
    return true;
  }

  onScrape(r: Scrape): boolean {
    const loan = this.held.get(r.handle) ?? (this.loading?.handle === r.handle ? this.loading : undefined);
    if (!loan) return false;
    const { scraped, kept } = loan.scrape(r);
    this.client()?.sendScraped(r.handle, r.order, r.epoch, r.through, scraped.length, piecesKib(scraped), kept);
    if (scraped.length > 0) this.redraw(loan);
    return true;
  }

  onAudit(a: Audit): boolean {
    const loan = this.held.get(a.handle);
    if (!loan) return false;
    const held = loan.pieces().filter((p) => p.delivery <= a.through);
    this.client()?.sendInventory(a.handle, a.order, a.through, held.length, piecesKib(held), loan.numbersThrough(a.through));
    return true;
  }

  /** Spec 5.2.2: pieces whose lease ran out are released (SOLTAR CADUCADA); without its seed the canvas closes. */
  sweep(now: number): void {
    for (const loan of [...this.held.values()]) {
      const gone = loan.expired(now);
      if (gone.length === 0) continue;
      this.release(loan, SOLTAR_CADUCADA, gone.map((p) => p.delivery));
      loan.remove(gone);
      if (loan.seed) this.redraw(loan);
      else this.close(loan);
    }
  }

  onError(id: string): void {
    if (this.loading?.id !== id) return;
    this.close(this.loading);
    this.loading = null;
    this.pump();
  }

  dispose(): void {
    this.pause();
    this.queue = [];
  }

  private release(loan: PreviewLoan, reason: number, numbers: number[]): true {
    if (numbers.length > 0) this.client()?.sendRelease(loan.handle, reason, numbers);
    return true;
  }

  /** What the loan still holds is shown again: less detail, or nothing once the seed is gone. */
  private redraw(loan: PreviewLoan): void {
    if (loan.seed) this.draw(loan);
    else dropWorkPreview(loan.id);
  }

  private draw(loan: PreviewLoan): void {
    if (this.drawing.has(loan)) {
      this.stale.add(loan);
      return;
    }
    this.drawing.add(loan);
    composePreview(loan, this.decoder)
      .then((img) => {
        if (img && loan.seed && this.held.get(loan.handle) === loan) setWorkPreview(loan.id, img);
      })
      .catch((err: unknown) => {
        if (this.held.get(loan.handle) === loan) console.warn('Preview decode error for', loan.id, err);
      })
      .finally(() => {
        this.drawing.delete(loan);
        if (this.stale.delete(loan) && this.held.get(loan.handle) === loan) this.draw(loan);
        else this.pump();
      });
  }

  private close(loan: PreviewLoan): void {
    if (loan === this.loading && this.timer) clearTimeout(this.timer);
    this.held.delete(loan.handle);
    this.stale.delete(loan);
    dropWorkPreview(loan.id);
    if (loan.handle > 0) this.client()?.closeHandle(loan.handle);
  }

  private pump(): void {
    if (this.paused || this.loading !== null) return;
    const nextId = this.queue.shift();
    if (!nextId) return;
    if (hasWorkPreview(nextId)) {
      this.pump();
      return;
    }
    const loan = new PreviewLoan(nextId);
    this.timer = setTimeout(() => {
      if (this.loading !== loan) return;
      this.close(loan);
      this.loading = null;
      this.pump();
    }, OPEN_TIMEOUT_MS);
    this.loading = loan;
    this.client()?.openPreview(nextId);
  }
}
