/**
 * cola_ms (spec 6.1): synthesis work still inside the worker, measured rather than guessed.
 * Every posted brush gets exactly one reply (ok or error), so the count returns to 0 when idle.
 * With a worker pool the honest backlog is the drain time: all outstanding work
 * divided by the workers draining it.
 */
export class DecodeQueue {
  private inWorker = 0;
  private waiting = 0;
  private parallel = 1;
  private avgMs = 5;

  posted(): void {
    this.inWorker += 1;
  }

  answered(elapsedMs: number): void {
    this.inWorker = Math.max(0, this.inWorker - 1);
    this.avgMs = 0.8 * this.avgMs + 0.2 * elapsedMs;
  }

  /** Jobs ready but held back because every worker is busy. */
  setWaiting(n: number): void {
    this.waiting = Math.max(0, n);
  }

  setParallelism(n: number): void {
    this.parallel = Math.max(1, n);
  }

  get ms(): number {
    return ((this.inWorker + this.waiting) * this.avgMs) / this.parallel;
  }

  /** The moving average of one synthesis job (ms). */
  get jobMs(): number {
    return this.avgMs;
  }

  /** The number of workers draining the queue. */
  get workers(): number {
    return this.parallel;
  }
}
