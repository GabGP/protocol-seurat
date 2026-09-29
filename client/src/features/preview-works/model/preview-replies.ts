import { LEASE_S, MS_PER_S, PREVIEW_CREDIT } from '@/shared/config/constants';
import type { SessionClient } from '@/entities/session';
import type { Audit, Renew, Scrape } from '@/shared/proto/messages';
import type { PreviewLoan } from './preview-loan';
import { piecesKib } from './preview-piece';
import { previewGaze, type PreviewGaze } from './preview-gaze';
import type { PreviewPainter } from './preview-painter';

/** Everything the preview manager says back to the server: receipts, releases, gazes and the RENOVAR / RASPAR / AUDITAR answers. */
export class PreviewReplies {
  /** MIRADA seq, rising across every card. */
  private gazeSeq = 0;

  constructor(private readonly client: () => SessionClient | null, private readonly painter: PreviewPainter) {}

  /** The card looks at its work again: a reliable MIRADA at its own device pixels. */
  gaze(loan: PreviewLoan, now: number): PreviewGaze {
    loan.gazedAt = now;
    const g = previewGaze(loan, loan.workW, loan.workH, ++this.gazeSeq);
    this.client()?.sendGazeReliable(g);
    return g;
  }

  release(loan: PreviewLoan, reason: number, numbers: number[]): true {
    if (numbers.length > 0) this.client()?.sendRelease(loan.handle, reason, numbers);
    return true;
  }

  receipt(loan: PreviewLoan, delivery: number): void {
    this.client()?.sendReceipt(loan.handle, [delivery], 0, PREVIEW_CREDIT, 0);
  }

  /** The answers below return false when the handle is not one of ours (the caller then tries elsewhere). */
  renew(loan: PreviewLoan | undefined, r: Renew): boolean {
    if (!loan) return false;
    loan.renew(r.ranges, r.leaseS, performance.now());
    loan.renewThrough = Math.max(loan.renewThrough, r.order);
    this.client()?.sendReceipt(loan.handle, [], 0, PREVIEW_CREDIT, loan.renewThrough);
    return true;
  }

  scrape(loan: PreviewLoan | undefined, r: Scrape): boolean {
    if (!loan) return false;
    const { scraped, kept } = loan.scrape(r);
    this.client()?.sendScraped(r.handle, r.order, r.epoch, r.through, scraped.length, piecesKib(scraped), kept);
    if (scraped.length > 0) this.painter.redraw(loan);
    return true;
  }

  audit(loan: PreviewLoan | undefined, a: Audit): boolean {
    if (!loan) return false;
    const held = loan.pieces().filter((p) => p.delivery <= a.through);
    this.client()?.sendInventory(a.handle, a.order, a.through, held.length, piecesKib(held), loan.numbersThrough(a.through));
    return true;
  }
}

/** When a piece received at `now` runs out of lease. */
export const leaseExpiry = (now: number): number => now + LEASE_S * MS_PER_S;
