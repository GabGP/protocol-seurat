import { defaultWorker, resolvePoolSize, type SynthWorker, type WorkerFactory } from '@/entities/delivery/worker-pool';
import { PREVIEW_DECODERS_MAX, PREVIEW_DECODE_TIMEOUT_MS } from '@/shared/config/constants';
import type { SynthRequest, SynthResult } from '@/workers/protocol';

/** Planes of one decoded brush or seed (Y, Co, Cg), `width × height`. */
export interface DecodedPlanes {
  planes: Int16Array[];
  width: number;
  height: number;
}

export type DecodeRequest = Omit<SynthRequest, 'synthesisId'>;

interface Pending {
  worker: SynthWorker;
  timer: ReturnType<typeof setTimeout>;
  resolve: (d: DecodedPlanes) => void;
  reject: (e: Error) => void;
}

/**
 * Gallery thumbnails decode through the viewer's own synthesis worker, so the seed and the
 * brushes under it are reconstructed by the one decoder the spec defines. A few workers, made
 * as work arrives and ended with the gallery; each decode goes to the least loaded one. A worker
 * that fails or misses a deadline is replaced, failing only what it held: nothing waits forever.
 */
export class PreviewDecoder {
  private readonly workers: SynthWorker[] = [];
  private readonly size = Math.min(resolvePoolSize(), PREVIEW_DECODERS_MAX);
  private next = 1;
  private readonly waiting = new Map<number, Pending>();

  constructor(private readonly factory: WorkerFactory = defaultWorker) {}

  decode(req: DecodeRequest): Promise<DecodedPlanes> {
    const worker = this.pick();
    const synthesisId = this.next++;
    const transfer = [...req.bands, ...(req.parentPlanes ?? [])];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(worker, new Error('preview decode timed out')), PREVIEW_DECODE_TIMEOUT_MS);
      this.waiting.set(synthesisId, { worker, timer, resolve, reject });
      worker.postMessage({ ...req, synthesisId }, { transfer });
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.rejectWhere(() => true, new Error('preview decoder closed'));
  }

  /** The least loaded worker, or a new one while the pool is not full and every worker is busy. */
  private pick(): SynthWorker {
    const load = new Map(this.workers.map((w) => [w, 0]));
    for (const p of this.waiting.values()) load.set(p.worker, (load.get(p.worker) ?? 0) + 1);
    const idlest = this.workers.reduce<SynthWorker | null>((a, w) => (a && (load.get(a) ?? 0) <= (load.get(w) ?? 0) ? a : w), null);
    if (idlest && (load.get(idlest) === 0 || this.workers.length >= this.size)) return idlest;
    const w = this.factory();
    w.onmessage = (ev: MessageEvent<SynthResult>) => this.settle(ev.data);
    w.onerror = w.onmessageerror = () => this.fail(w, new Error('preview decode worker failed'));
    this.workers.push(w);
    return w;
  }

  private settle(r: SynthResult): void {
    const p = this.waiting.get(r.synthesisId);
    r.bitmap?.close(); // thumbnails are drawn from planes; the bitmap is not needed
    if (!p) return;
    this.waiting.delete(r.synthesisId);
    clearTimeout(p.timer);
    if (!r.ok || !r.planes) p.reject(new Error(r.error ?? 'preview decode failed'));
    else p.resolve({ planes: r.planes.map((b) => new Int16Array(b)), width: r.width, height: r.height });
  }

  /** Ends a worker that failed or stalled, and whatever it was decoding; later decodes start a new one. */
  private fail(worker: SynthWorker, err: Error): void {
    const i = this.workers.indexOf(worker);
    if (i < 0) return;
    this.workers.splice(i, 1);
    worker.terminate();
    this.rejectWhere((p) => p.worker === worker, err);
  }

  private rejectWhere(match: (p: Pending) => boolean, err: Error): void {
    for (const [id, p] of this.waiting) {
      if (!match(p)) continue;
      this.waiting.delete(id);
      clearTimeout(p.timer);
      p.reject(err);
    }
  }
}
