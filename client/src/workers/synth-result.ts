import { STALE_PARENT, type SynthRequest, type SynthResult } from './protocol';
import type { PlaneSet } from './synth-cache';

function failure(req: SynthRequest, t0: number, error: string): SynthResult {
  return {
    delivery: req.delivery,
    synthesisId: req.synthesisId,
    ok: false,
    error,
    rgba: null,
    planes: null,
    width: 0,
    height: 0,
    elapsedMs: performance.now() - t0,
  };
}

/** A `parentRef` miss: the main thread re-sends the parent bytes. Never fatal. */
export function postMiss(req: SynthRequest, t0: number): void {
  self.postMessage(failure(req, t0, STALE_PARENT));
}

export function postError(req: SynthRequest, t0: number, e: unknown): void {
  self.postMessage(failure(req, t0, e instanceof Error ? e.message : String(e)));
}

/** Post the planes (and the RGBA or bitmap built from them), transferring every buffer. */
export function postSuccess(
  req: SynthRequest,
  t0: number,
  planes: PlaneSet,
  rgba: Uint8ClampedArray | null,
  bitmap: ImageBitmap | null,
  width: number,
  height: number,
): void {
  const out: SynthResult = {
    delivery: req.delivery,
    synthesisId: req.synthesisId,
    ok: true,
    rgba: bitmap || !rgba ? null : (rgba.buffer as ArrayBuffer),
    bitmap,
    planes: [planes.Y.buffer as ArrayBuffer, planes.Co.buffer as ArrayBuffer, planes.Cg.buffer as ArrayBuffer],
    width,
    height,
    elapsedMs: performance.now() - t0,
  };
  const moved: Transferable[] = [...(out.planes ?? [])];
  if (out.rgba) moved.push(out.rgba);
  if (bitmap) moved.push(bitmap);
  self.postMessage(out, { transfer: moved });
}
