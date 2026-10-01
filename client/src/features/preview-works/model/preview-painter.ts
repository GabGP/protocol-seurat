import { dropWorkPreview, setWorkPreview } from '@/entities/work';
import { PREVIEW_LEVELS_KEEP_MS } from '@/shared/config/constants';
import type { PreviewLoan } from './preview-loan';
import type { PreviewDecoder } from './preview-decoder';
import { composePreview } from './preview-compose';
import { PreviewLevels } from './preview-levels';
import { PreviewFinisher } from './preview-finisher';

/**
 * Composes each held loan's thumbnail through the decoder and shows it. A loan that changes
 * while it is composed is composed once more as soon as that compose ends: whatever came in the
 * meantime is one compose, and no timer delays it (a hidden tab or a phone stretches timers to
 * seconds, and the card holds its open slot until it settles); `live` says whether it is still held,
 * and `idle` is told whenever a compose ends with nothing more to do for its loan. A loan's
 * decoded levels are kept while its pieces keep coming (PREVIEW_LEVELS_KEEP_MS after the last
 * compose), so each compose decodes and shows only what changed; a finished thumbnail keeps none.
 */
export class PreviewPainter {
  private readonly drawing = new Set<PreviewLoan>();
  private readonly stale = new Set<PreviewLoan>();
  private readonly kept = new Map<PreviewLoan, { levels: PreviewLevels; timer?: ReturnType<typeof setTimeout> }>();

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
    this.compose(loan);
  }

  /** What the loan still holds is shown again: less detail, or nothing once the seed is gone. */
  redraw(loan: PreviewLoan): void {
    if (loan.seed) this.draw(loan);
    else dropWorkPreview(loan.id);
  }

  forget(loan: PreviewLoan): void {
    this.stale.delete(loan);
    clearTimeout(this.kept.get(loan)?.timer);
    this.kept.delete(loan);
  }

  /** Ends every decode; composes in flight fail and end as their loans are no longer live. */
  dispose(): void {
    for (const loan of [...this.kept.keys()]) this.forget(loan);
    this.decoder.dispose();
    this.finisher.dispose();
  }

  private compose(loan: PreviewLoan): void {
    composePreview(loan, this.decoder, this.levels(loan), this.finisher)
      .then((img) => {
        if (img && loan.seed && this.live(loan)) setWorkPreview(loan.id, img);
      })
      .catch((err: unknown) => {
        if (this.live(loan)) console.warn('Preview decode error for', loan.id, err);
      })
      .finally(() => {
        if (!this.stale.delete(loan)) return this.settle(loan);
        queueMicrotask(() => (this.live(loan) ? this.compose(loan) : this.settle(loan)));
      });
  }

  /** Nothing more to compose for the loan: its levels are kept a while, then dropped. */
  private settle(loan: PreviewLoan): void {
    this.drawing.delete(loan);
    const kept = this.kept.get(loan);
    if (kept) kept.timer = setTimeout(() => this.forget(loan), PREVIEW_LEVELS_KEEP_MS);
    this.idle();
  }

  /** The loan's kept levels (new when none are), no longer due to be dropped. */
  private levels(loan: PreviewLoan): PreviewLevels {
    const kept = this.kept.get(loan) ?? { levels: new PreviewLevels() };
    clearTimeout(kept.timer);
    kept.timer = undefined;
    this.kept.set(loan, kept);
    return kept.levels;
  }
}
