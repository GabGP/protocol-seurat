export interface SynthRequest {
  delivery: number;
  synthesisId: number;
  stratum: number;
  qY: number;
  qC: number;
  seed: boolean;
  seedWidth: number;
  seedHeight: number;
  /** Cache/family identity `${brush}/${edition}`; the worker keys its plane cache on it. */
  brush: string;
  edition: number;
  parentPlanes?: ArrayBuffer[];
  /** Which parent the bytes belong to (insert under this key). */
  parentKey?: string;
  /**
   * Reference a cached parent instead of transferring bytes (crop geometry
   * stays). Precedence over parentPlanes. Miss replies STALE_PARENT, never fatal.
   */
  parentRef?: string;
  parentPlaneWidth?: number;
  parentPlaneHeight?: number;
  parentX?: number;
  parentY?: number;
  bands: ArrayBuffer[];
}

export interface SynthResult {
  delivery: number;
  synthesisId: number;
  ok: boolean;
  error?: string;
  /** Raw RGBA, only when the worker could not build `bitmap` itself. */
  rgba: ArrayBuffer | null;
  bitmap?: ImageBitmap | null;
  planes: ArrayBuffer[] | null;
  width: number;
  height: number;
  elapsedMs: number;
}

export type WorkerIn = SynthRequest;
export type WorkerOut = SynthResult;

/** parentRef miss: re-send with parentPlanes bytes. Never fatal, never released. */
export const STALE_PARENT = 'stale-parent';

/**
 * Worker plane-cache sizes (worker-owned numbers: workers/ stays free of
 * shared/ imports). ~16 full parents ≈ 6 MB per worker worst case.
 */
export const SYNTH_CACHE_SMALL = 2;
export const SYNTH_CACHE_MAIN = 14;
export const SYNTH_CACHE_GHOST = 32;
