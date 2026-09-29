import { REFETCH_SAMPLES } from '@/shared/config/eviction';

/** What telemetry shows of eviction: how much Horizon dropped and how much of it the server sent again. */
export interface EvictionView {
  evicted: number;
  evictedBytes: number;
  refetched: number;
  refetchedBytes: number;
  /** Median ms from an eviction to the same brush arriving again; null before any refetch. */
  medianRefetchMs: number | null;
}

/** Local counters only: nothing here goes on the wire. */
export class EvictionStats {
  private evictedCount = 0;
  private evictedTotal = 0;
  private refetchedCount = 0;
  private refetchedTotal = 0;
  private delays: number[] = [];
  private counted = new Set<number>();

  evict(bytes: number): void {
    this.evictedCount += 1;
    this.evictedTotal += bytes;
  }

  /**
   * The brush evicted as `evictedDelivery` arrived again after `ms`. Several deliveries of one brush
   * (its bands come in steps) add their bytes but count as one refetch.
   */
  refetch(evictedDelivery: number, bytes: number, ms: number): void {
    this.refetchedTotal += bytes;
    if (this.counted.has(evictedDelivery)) return;
    this.counted.add(evictedDelivery);
    if (this.counted.size > REFETCH_SAMPLES) this.counted.delete(this.counted.values().next().value!);
    this.refetchedCount += 1;
    this.delays.push(Math.max(0, ms));
    if (this.delays.length > REFETCH_SAMPLES) this.delays.shift();
  }

  view(): EvictionView {
    const sorted = [...this.delays].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length === 0 ? null : sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    return {
      evicted: this.evictedCount, evictedBytes: this.evictedTotal,
      refetched: this.refetchedCount, refetchedBytes: this.refetchedTotal, medianRefetchMs: median,
    };
  }
}
