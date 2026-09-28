import { finishRegion, type FinishRequest, type FinishResult } from '@/workers/preview-finish';
import { cutRegion, patchRegion, type Planes, type Rect } from '@/workers/plane-shrink';

/** The finishing worker's surface; the real Worker satisfies it structurally. */
export interface FinishWorker {
  postMessage(req: FinishRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: MessageEvent<FinishResult>) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
}

export type FinishFactory = () => FinishWorker | null;

function defaultFinisher(): FinishWorker | null {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('../../../workers/preview-finish.worker.ts', import.meta.url), { type: 'module' });
}

/** A finished part of a thumbnail: its RGBA and where it goes in the card's image. */
export interface PreviewPatch {
  rgba: Uint8ClampedArray;
  rect: Rect;
}

/**
 * Shrinks the changed part of a composed level to the card and turns it to RGBA in one worker,
 * so the gallery's largest per-pixel pass never blocks the page (a phone froze on it). Only the
 * level samples that part reads are copied out; the level stays the caller's. Without a worker,
 * or once it failed, the same pass runs here.
 */
export class PreviewFinisher {
  private worker: FinishWorker | null | undefined;
  private next = 1;
  private readonly waiting = new Map<number, { rect: Rect; resolve: (p: PreviewPatch) => void; reject: (e: Error) => void }>();

  constructor(private readonly factory: FinishFactory = defaultFinisher) {}

  /** The part of `level` shown at `width × height` that samples the level's `dirty` part. */
  finish(level: Planes, width: number, height: number, dirty: Rect): Promise<PreviewPatch> {
    const { src, out } = patchRegion(level.width, level.height, width, height, dirty);
    const req = { src, out, levelWidth: level.width, levelHeight: level.height, width, height };
    const cut = cutRegion(level.planes, level.width, src);
    const worker = this.pick();
    if (!worker) return Promise.resolve({ rgba: finishRegion(req, cut), rect: out });
    const id = this.next++;
    const planes = cut.map((p) => p.buffer as ArrayBuffer);
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { rect: out, resolve, reject });
      worker.postMessage({ id, planes, ...req }, planes);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.rejectAll(new Error('preview finisher closed'));
  }

  private pick(): FinishWorker | null {
    if (this.worker !== undefined) return this.worker;
    const w = this.factory();
    if (w) {
      w.onmessage = (ev) => this.settle(ev.data);
      w.onerror = () => this.fail(w);
    }
    this.worker = w;
    return w;
  }

  private settle(r: FinishResult): void {
    const p = this.waiting.get(r.id);
    if (!p) return;
    this.waiting.delete(r.id);
    if (r.rgba) p.resolve({ rgba: new Uint8ClampedArray(r.rgba), rect: p.rect });
    else p.reject(new Error('preview finish failed'));
  }

  /** A failed worker is not replaced: later thumbnails finish on the main thread. */
  private fail(w: FinishWorker): void {
    w.terminate();
    this.worker = null;
    this.rejectAll(new Error('preview finish worker failed'));
  }

  private rejectAll(err: Error): void {
    for (const p of this.waiting.values()) p.reject(err);
    this.waiting.clear();
  }
}
