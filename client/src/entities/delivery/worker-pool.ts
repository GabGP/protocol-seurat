import {
  SYNTH_POOL_FALLBACK_CORES,
  SYNTH_POOL_MAX,
  SYNTH_POOL_MIN,
} from '@/shared/config/constants';
import type { SynthRequest } from '@/workers/protocol';

/** Minimal synthesis worker surface; the real Worker satisfies it structurally. */
export interface SynthWorker {
  postMessage(req: SynthRequest, options: { transfer: Transferable[] }): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent) => void) | null;
}

/** Builds one synthesis worker; injectable so tests can pass fakes. */
export type WorkerFactory = () => SynthWorker;

export function defaultWorker(): SynthWorker {
  return new Worker(new URL('../../workers/synthesis.worker.ts', import.meta.url), { type: 'module' });
}

/** Clamp raw core counts to the synthesis pool range. */
export function poolSizeFor(cores: number | undefined): number {
  const hw = cores ?? SYNTH_POOL_FALLBACK_CORES;
  return Math.max(SYNTH_POOL_MIN, Math.min(SYNTH_POOL_MAX, hw - 1));
}

/** One core stays free for the main thread + compositor. */
export function resolvePoolSize(): number {
  const cores = typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;
  return poolSizeFor(cores);
}

/**
 * Least-loaded pool: each worker holds at most one synthesis (depth 1), so a
 * slow brush never queues behind another inside a worker mailbox. Anything
 * waiting stays in the priority queue, where it can still be reordered.
 */
export class WorkerPool {
  private readonly workers: SynthWorker[] = [];
  private readonly busy: boolean[] = [];
  private onResult: ((index: number, ev: MessageEvent) => void) | null = null;

  constructor(
    readonly size: number,
    factory: WorkerFactory,
  ) {
    for (let i = 0; i < size; i++) {
      const index = i;
      const w = factory();
      w.onmessage = (ev: MessageEvent) => this.onResult?.(index, ev);
      this.workers.push(w);
      this.busy.push(false);
    }
  }

  onResults(fn: (index: number, ev: MessageEvent) => void): void {
    this.onResult = fn;
  }

  /** First idle worker, or -1 while every worker synthesizes. */
  idleIndex(): number {
    return this.busy.findIndex((b) => !b);
  }

  isIdle(index: number): boolean {
    return this.busy[index] === false;
  }

  /** Workers currently synthesizing (for telemetry). */
  busyCount(): number {
    return this.busy.filter((b) => b).length;
  }

  send(index: number, req: SynthRequest, transfer: Transferable[]): void {
    const w = this.workers[index];
    if (w === undefined) throw new Error(`no synthesis worker ${index}`);
    w.postMessage(req, { transfer });
    this.busy[index] = true;
  }

  complete(index: number): void {
    this.busy[index] = false;
  }

  dispose(): void {
    this.onResult = null;
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.busy.length = 0;
  }
}
