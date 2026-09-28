import { hasWorkPreview } from '@/entities/work/previews';
import { PREVIEW_OPEN_TIMEOUT_MS } from '@/shared/config/constants';
import { PreviewLoan } from './preview-loan';

/**
 * The works waiting for a card, in the gallery's order, and those being opened: from ABRIR
 * until their seed arrives. One that brings no seed in time is given up (`onTimeout`).
 */
export class PreviewOpens {
  private queue: string[] = [];
  private readonly opening = new Map<PreviewLoan, ReturnType<typeof setTimeout>>();

  constructor(private readonly onTimeout: (loan: PreviewLoan) => void) {}

  /** Queues every id not shown, queued or being opened, and orders the queue as `ids`. */
  enqueue(ids: string[]): void {
    for (const id of ids) {
      if (!hasWorkPreview(id) && !this.queue.includes(id) && !this.byId(id)) this.queue.push(id);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    this.queue.sort((a, b) => (order.get(a) ?? ids.length) - (order.get(b) ?? ids.length));
  }

  /** Takes queued works until `limit` are being opened; returns the new ones. */
  start(limit: number): PreviewLoan[] {
    const started: PreviewLoan[] = [];
    while (this.opening.size < limit) {
      const id = this.queue.shift();
      if (id === undefined) break;
      if (hasWorkPreview(id)) continue;
      const loan = new PreviewLoan(id);
      this.opening.set(loan, setTimeout(() => this.onTimeout(loan), PREVIEW_OPEN_TIMEOUT_MS));
      started.push(loan);
    }
    return started;
  }

  byId(id: string): PreviewLoan | undefined {
    return [...this.opening.keys()].find((l) => l.id === id);
  }

  byHandle(handle: number): PreviewLoan | undefined {
    return [...this.opening.keys()].find((l) => l.handle === handle);
  }

  /** The loan's seed arrived, or it was given up: it is no longer being opened. */
  done(loan: PreviewLoan): boolean {
    const timer = this.opening.get(loan);
    if (timer === undefined) return false;
    clearTimeout(timer);
    return this.opening.delete(loan);
  }

  /** Every loan being opened, no longer tracked. */
  drain(): PreviewLoan[] {
    const all = [...this.opening.keys()];
    for (const l of all) this.done(l);
    return all;
  }

  /** Puts `ids` back at the head of the queue. */
  requeueFirst(ids: string[]): void {
    this.queue = [...new Set([...ids, ...this.queue])];
  }

  clear(): void {
    this.drain();
    this.queue = [];
  }
}
