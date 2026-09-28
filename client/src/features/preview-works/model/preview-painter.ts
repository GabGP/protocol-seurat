import { dropWorkPreview, setWorkPreview } from '@/entities/work/previews';
import type { PreviewLoan } from './preview-loan';
import type { PreviewDecoder } from './preview-decoder';
import { composePreview } from './preview-compose';

/**
 * Composes each held loan's thumbnail through the decoder and shows it. A loan that changes
 * while it is composed is composed once more after; `live` says whether it is still held,
 * and `idle` is told whenever a compose ends with nothing more to do for its loan.
 */
export class PreviewPainter {
  private readonly drawing = new Set<PreviewLoan>();
  private readonly stale = new Set<PreviewLoan>();

  constructor(
    private readonly decoder: PreviewDecoder,
    private readonly live: (loan: PreviewLoan) => boolean,
    private readonly idle: () => void,
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
    composePreview(loan, this.decoder)
      .then((img) => {
        if (img && loan.seed && this.live(loan)) setWorkPreview(loan.id, img);
      })
      .catch((err: unknown) => {
        if (this.live(loan)) console.warn('Preview decode error for', loan.id, err);
      })
      .finally(() => {
        this.drawing.delete(loan);
        if (this.stale.delete(loan) && this.live(loan)) this.draw(loan);
        else this.idle();
      });
  }

  /** What the loan still holds is shown again: less detail, or nothing once the seed is gone. */
  redraw(loan: PreviewLoan): void {
    if (loan.seed) this.draw(loan);
    else dropWorkPreview(loan.id);
  }

  forget(loan: PreviewLoan): void {
    this.stale.delete(loan);
  }

  /** Ends every decode; composes in flight fail and end as their loans are no longer live. */
  dispose(): void {
    this.decoder.dispose();
  }
}
