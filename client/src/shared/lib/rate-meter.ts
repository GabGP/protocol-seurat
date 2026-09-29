import { MS_PER_S } from '../config/units';
const BUCKET_MS = 250;
const SLOTS = 240; // 60 s of history
const PER_S = MS_PER_S / BUCKET_MS;

/** Byte-rate meter over 250 ms buckets: live rate, recent peak and per-second history (60 s). */
export class RateMeter {
  private readonly buckets = new Float64Array(SLOTS);
  private head: number | null = null; // absolute index of the newest bucket
  total = 0;

  record(bytes: number, now: number): void {
    const k = slot(this.advance(now));
    this.buckets[k] = (this.buckets[k] ?? 0) + bytes;
    this.total += bytes;
  }

  /** Bytes/s over the last `windowMs`: a live reading that falls to 0 when the link is idle. */
  rate(now: number, windowMs = 1000): number {
    const head = this.advance(now);
    const n = Math.max(1, Math.round(windowMs / BUCKET_MS));
    return this.sum(head - n + 1, head) / ((n * BUCKET_MS) / MS_PER_S);
  }

  /** Best 1 s rate within the last `spanMs`: what the link carried while it was busy. */
  peak(now: number, spanMs = 10_000): number {
    const head = this.advance(now);
    const n = Math.min(SLOTS, Math.round(spanMs / BUCKET_MS));
    let best = 0;
    for (let end = head - n + PER_S; end <= head; end++) {
      best = Math.max(best, this.sum(end - PER_S + 1, end));
    }
    return best;
  }

  /** Bytes per second for the last `seconds`, oldest first. */
  history(now: number, seconds = 60): number[] {
    const head = this.advance(now);
    const out: number[] = [];
    for (let s = seconds - 1; s >= 0; s--) {
      const end = head - s * PER_S;
      out.push(this.sum(end - PER_S + 1, end));
    }
    return out;
  }

  private sum(from: number, to: number): number {
    const head = this.head ?? to;
    let total = 0;
    for (let i = Math.max(from, head - SLOTS + 1); i <= to; i++) total += this.buckets[slot(i)] ?? 0;
    return total;
  }

  private advance(now: number): number {
    const idx = Math.floor(now / BUCKET_MS);
    if (this.head === null || idx - this.head >= SLOTS) {
      this.buckets.fill(0);
      this.head = idx;
    } else if (idx > this.head) {
      for (let i = this.head + 1; i <= idx; i++) this.buckets[slot(i)] = 0;
      this.head = idx;
    }
    return this.head;
  }
}

function slot(i: number): number {
  return ((i % SLOTS) + SLOTS) % SLOTS;
}
