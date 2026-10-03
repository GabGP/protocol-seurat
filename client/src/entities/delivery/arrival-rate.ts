import { ARRIVAL_MIN_SAMPLES, ARRIVAL_SAMPLES, MS_PER_S } from '@/shared/config/constants';

/**
 * The rate deliveries arrive at back to back: the median of bytes / gap over the last ARRIVAL_SAMPLES arrivals
 * (0 before ARRIVAL_MIN_SAMPLES). A gap that holds idle link reads low and a burst read in one task reads high; the
 * median keeps the back-to-back spacing (ADR-08 amendment).
 */
export class ArrivalRate {
  private lastMs: number | null = null;
  private readonly samples: number[] = [];

  note(bytes: number, nowMs: number): void {
    if (this.lastMs !== null) {
      const gap = nowMs - this.lastMs;
      if (gap > 0 && bytes > 0) {
        this.samples.push((bytes * MS_PER_S) / gap);
        if (this.samples.length > ARRIVAL_SAMPLES) {
          this.samples.shift();
        }
      }
    }
    this.lastMs = nowMs;
  }

  bps(): number {
    if (this.samples.length < ARRIVAL_MIN_SAMPLES) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    return Math.round(median);
  }
}
