import { defaultWorker, type SynthWorker, type WorkerFactory } from '@/entities/delivery/worker-pool';
import type { SynthRequest, SynthResult } from '@/workers/protocol';

/** Planes of one decoded brush or seed (Y, Co, Cg), `width × height`. */
export interface DecodedPlanes {
  planes: Int16Array[];
  width: number;
  height: number;
}

export type DecodeRequest = Omit<SynthRequest, 'synthesisId'>;

/**
 * Gallery thumbnails decode through the viewer's own synthesis worker, so the seed and the
 * brushes under it are reconstructed by the one decoder the spec defines. A single worker,
 * made on first use and ended with the gallery; requests answer in order.
 */
export class PreviewDecoder {
  private worker: SynthWorker | null = null;
  private next = 1;
  private readonly waiting = new Map<number, { resolve: (d: DecodedPlanes) => void; reject: (e: Error) => void }>();

  constructor(private readonly factory: WorkerFactory = defaultWorker) {}

  decode(req: DecodeRequest): Promise<DecodedPlanes> {
    const w = this.ensure();
    const synthesisId = this.next++;
    const transfer = [...req.bands, ...(req.parentPlanes ?? [])];
    return new Promise((resolve, reject) => {
      this.waiting.set(synthesisId, { resolve, reject });
      w.postMessage({ ...req, synthesisId }, { transfer });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const w of this.waiting.values()) w.reject(new Error('preview decoder closed'));
    this.waiting.clear();
  }

  private ensure(): SynthWorker {
    if (this.worker) return this.worker;
    const w = this.factory();
    w.onmessage = (ev: MessageEvent<SynthResult>) => this.settle(ev.data);
    this.worker = w;
    return w;
  }

  private settle(r: SynthResult): void {
    const w = this.waiting.get(r.synthesisId);
    r.bitmap?.close(); // thumbnails are drawn from planes; the bitmap is not needed
    if (!w) return;
    this.waiting.delete(r.synthesisId);
    if (!r.ok || !r.planes) w.reject(new Error(r.error ?? 'preview decode failed'));
    else w.resolve({ planes: r.planes.map((b) => new Int16Array(b)), width: r.width, height: r.height });
  }
}
