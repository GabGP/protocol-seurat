import { dropWorkPreview, setWorkPreview } from '@/entities/work/previews';
import { PREVIEW_MEMO_KEEP_MS } from '@/shared/config/constants';
import type { PreviewLoan } from './preview-loan';
import type { PreviewDecoder } from './preview-decoder';
import { composePreview } from './preview-compose';
import { BrushMemo } from './preview-memo';
import { PreviewFinisher } from './preview-finisher';

/**
 * Composes each held loan's thumbnail through the decoder and shows it. A loan that changes
 * while it is composed is composed once more after; `live` says whether it is still held,
 * and `idle` is told whenever a compose ends with nothing more to do for its loan. A loan's
 * decoded brushes are kept while its pieces keep coming (PREVIEW_MEMO_KEEP_MS after the last
 * compose), so each compose decodes only what changed; a finished thumbnail keeps none.
 */
export class PreviewPainter {
  private readonly drawing = new Set<PreviewLoan>();
  private readonly stale = new Set<PreviewLoan>();
  private readonly memos = new Map<PreviewLoan, { memo: BrushMemo; timer?: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly decoder: PreviewDecoder,
    private readonly live: (loan: PreviewLoan) => boolean,
    private readonly idle: () => void,
    private readonly finisher = new PreviewFinisher(),
  ) {}

  /** Loans being composed now. */
  get busy(): number {
    return this.drawing.size;
  }

  draw(loan: PreviewLoan): void {
    if (this.drawing.has(loan)) {
      this.stale.add(loan);
      return;
    }
    this.drawing.add(loan);
    composePreview(loan, this.decoder, this.memo(loan), this.finisher)
      .then((img) => {
        if (img && loan.seed && this.live(loan)) setWorkPreview(loan.id, img);
      })
      .catch((err: unknown) => {
        if (this.live(loan)) console.warn('Preview decode error for', loan.id, err);
      })
      .finally(() => {
        this.drawing.delete(loan);
        if (this.stale.delete(loan) && this.live(loan)) return this.draw(loan);
        const kept = this.memos.get(loan);
        if (kept) kept.timer = setTimeout(() => this.forget(loan), PREVIEW_MEMO_KEEP_MS);
        this.idle();
      });
  }

  /** What the loan still holds is shown again: less detail, or nothing once the seed is gone. */
  redraw(loan: PreviewLoan): void {
    if (loan.seed) this.draw(loan);
    else dropWorkPreview(loan.id);
  }

  forget(loan: PreviewLoan): void {
    this.stale.delete(loan);
    clearTimeout(this.memos.get(loan)?.timer);
    this.memos.delete(loan);
  }

  /** Ends every decode; composes in flight fail and end as their loans are no longer live. */
  dispose(): void {
    for (const loan of [...this.memos.keys()]) this.forget(loan);
    this.decoder.dispose();
    this.finisher.dispose();
  }

  /** The loan's kept brushes (new when none are), no longer due to be dropped. */
  private memo(loan: PreviewLoan): BrushMemo {
    const kept = this.memos.get(loan) ?? { memo: new BrushMemo() };
    clearTimeout(kept.timer);
    kept.timer = undefined;
    this.memos.set(loan, kept);
    return kept.memo;
  }
}
