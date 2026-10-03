import { CREDIT_RTT_MAX_S, CREDIT_RTT_WINDOW_MS, MS_PER_S, RTT_PENDING_MAX } from '@/shared/config/constants';
import { clamp } from '@/shared/lib/clamp';

interface Sample {
  rttS: number;
  atMs: number;
}

/**
 * Tracks the minimum round-trip time between MIRADA and the server's first PLAN response.
 *
 * Samples are only those with no delivery arriving between MIRADA and PLAN, so the minimum is
 * the round trip of the path, never of the client's own queue (ADR-08 amendment).
 * The CREDIT_RTT_WINDOW_MS window lets it re-learn if network conditions change.
 */
export class MinRtt {
  private readonly pending = new Map<number, number>();
  private samples: Sample[] = [];
  private mostRecent: number | null = null;
  private lastFlowMs = -Infinity;

  /** A delivery arrived. A PLAN answering a MIRADA sent before it was queued behind it in the same stream. */
  arrived(now = performance.now()): void {
    this.lastFlowMs = now;
  }

  /** Remembers when a MIRADA seq was sent (bounded to RTT_PENDING_MAX, oldest dropped). */
  sent(seq: number, now = performance.now()): void {
    if (seq <= 0) return;
    this.pending.delete(seq);
    this.pending.set(seq, now);
    if (this.pending.size > RTT_PENDING_MAX) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
  }

  /**
   * Records an RTT sample on the first PLAN for a pending seq and forgets that seq.
   * Later PLANs for the same seq or unknown seqs are ignored.
   */
  answered(seq: number, now = performance.now()): void {
    if (seq <= 0) return;
    const sentAt = this.pending.get(seq);
    if (sentAt === undefined) return;
    this.pending.delete(seq);
    if (this.lastFlowMs >= sentAt) return;
    const rttS = Math.max(0, now - sentAt) / MS_PER_S;
    this.mostRecent = rttS;
    const cutoff = now - CREDIT_RTT_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.atMs >= cutoff);
    this.samples.push({ rttS, atMs: now });
  }

  /**
   * Minimum RTT (seconds) observed within CREDIT_RTT_WINDOW_MS, or the most recent sample
   * if none fall in that window, or 0 before any sample. Clamped to CREDIT_RTT_MAX_S.
   */
  seconds(now = performance.now()): number {
    const cutoff = now - CREDIT_RTT_WINDOW_MS;
    this.samples = this.samples.filter((s) => s.atMs >= cutoff);
    if (this.samples.length > 0) {
      let min = Infinity;
      for (const s of this.samples) {
        if (s.rttS < min) min = s.rttS;
      }
      return clamp(min, 0, CREDIT_RTT_MAX_S);
    }
    if (this.mostRecent !== null) {
      return clamp(this.mostRecent, 0, CREDIT_RTT_MAX_S);
    }
    return 0;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
