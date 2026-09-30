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
  /** A local rebuild of a released bitmap: the worker paints as usual, only the sink treats the answer differently. */
  restore?: boolean;
  /** Reply with the planes alone: no RGBA, no bitmap, nothing kept in the parent cache. */
  planesOnly?: boolean;
  /** With `planesOnly`: still retain the planes in the worker's cache (a rebuild of a parent children are routed to). */
  keep?: boolean;
  /** How many parents the receiving worker may keep (the pool's share of SYNTH_CACHE_TOTAL); absent: the default caps. */
  cacheEntries?: number;
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
 * Worker plane-cache sizes (worker-owned numbers: the worker imports shared/codec
 * and shared/config only). Defaults are for a request that names no size (~16 full parents,
 * ≈ 6 MB per worker); a pool sizes them from SYNTH_CACHE_TOTAL so more workers do not mean more memory.
 */
export const SYNTH_CACHE_SMALL = 2;
export const SYNTH_CACHE_MAIN = 14;
export const SYNTH_CACHE_GHOST = 32;
/** Parents kept by the whole pool, and the floor per worker. */
export const SYNTH_CACHE_TOTAL = 48;
export const SYNTH_CACHE_MIN_PER_WORKER = 4;
/** The probationary queue is one eighth of a worker's entries (at least one). */
export const SYNTH_CACHE_SMALL_SHARE = 8;
/** One cached parent: three Int16 planes of a 256 x 256 brush. */
export const SYNTH_PLANES_BYTES = 3 * 256 * 256 * 2;
