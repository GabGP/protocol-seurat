import { TILE, TILE_HALF, TILE_HALF_CELLS } from '@/shared/config/protocol';
import {
  planesKey, SYNTH_CACHE_GHOST, SYNTH_CACHE_MAIN, SYNTH_CACHE_SMALL, SYNTH_CACHE_SMALL_SHARE, type SynthRequest,
} from './protocol';
import { PLANE_CHANNELS, ParentPlaneCache, type PlaneSet } from './synth-cache';

/** Parent planes this worker synthesized or received: ref hits skip transfers. */
export const parents = new ParentPlaneCache(SYNTH_CACHE_SMALL, SYNTH_CACHE_MAIN, SYNTH_CACHE_GHOST);

/** Applies the pool's share of the cache budget, when the request carries one. */
export function sizeCache(req: SynthRequest): void {
  const entries = req.cacheEntries;
  if (entries === undefined || entries < 2) return;
  const small = Math.max(1, Math.floor(entries / SYNTH_CACHE_SMALL_SHARE));
  parents.resize(small, entries - small);
}

/** Cache identity of the planes this request makes: the key the main thread refers to them by. */
export function ownKey(req: SynthRequest): string {
  return planesKey(req.brush, req.synthesisId);
}

export function emptyPlanes(cells: number): PlaneSet {
  return { Y: new Int16Array(cells), Co: new Int16Array(cells), Cg: new Int16Array(cells) };
}

/** The half-resolution window of a full plane that parents this brush, edge-clamped. */
function cropInto(source: Int16Array, width: number, height: number, x0: number, y0: number, target: Int16Array): void {
  for (let y = 0; y < TILE_HALF; y++) {
    for (let x = 0; x < TILE_HALF; x++) {
      const sx = Math.min(width - 1, x0 + x);
      const sy = Math.min(height - 1, y0 + y);
      target[y * TILE_HALF + x] = source[sy * width + sx] ?? 0;
    }
  }
}

function cropGeometry(req: SynthRequest): { width: number; height: number; x0: number; y0: number } {
  return {
    width: req.parentPlaneWidth ?? TILE,
    height: req.parentPlaneHeight ?? TILE,
    x0: req.parentX ?? 0,
    y0: req.parentY ?? 0,
  };
}

/** Crop the parent planes that travelled with the request. */
function cropTransferred(req: SynthRequest, target: PlaneSet): void {
  if (!req.parentPlanes) return;
  const { width, height, x0, y0 } = cropGeometry(req);
  for (let c = 0; c < PLANE_CHANNELS.length; c++) {
    const name = PLANE_CHANNELS[c];
    if (!name) continue;
    cropInto(new Int16Array(req.parentPlanes[c] ?? new ArrayBuffer(0)), width, height, x0, y0, target[name]);
  }
}

/** Crop cached full planes with the same geometry the bytes path would use. */
function cropCached(hit: PlaneSet, req: SynthRequest, target: PlaneSet): void {
  const { width, height, x0, y0 } = cropGeometry(req);
  cropInto(hit.Y, width, height, x0, y0, target.Y);
  cropInto(hit.Co, width, height, x0, y0, target.Co);
  cropInto(hit.Cg, width, height, x0, y0, target.Cg);
}

/** Received bytes also populate the cache under their parent key (copied). */
function cacheBytes(req: SynthRequest): void {
  if (req.parentKey === undefined || req.parentPlanes === undefined) return;
  const bufs = req.parentPlanes;
  if (bufs.length !== 3 || bufs.some((b) => b === undefined || b.byteLength === 0)) return;
  const views = bufs.map((b) => new Int16Array(b ?? new ArrayBuffer(0)).slice());
  const Y = views[0];
  const Co = views[1];
  const Cg = views[2];
  if (Y === undefined || Co === undefined || Cg === undefined) return;
  parents.store(req.parentKey, { Y, Co, Cg });
}

/** The parent of this brush cropped to half resolution, or null on a `parentRef` miss (stale parent). */
export function resolveParent(req: SynthRequest): PlaneSet | null {
  const target = emptyPlanes(TILE_HALF_CELLS);
  if (req.parentRef !== undefined) {
    const hit = parents.fetch(req.parentRef);
    if (!hit) return null;
    cropCached(hit, req, target);
    return target;
  }
  cropTransferred(req, target);
  cacheBytes(req);
  return target;
}

/**
 * Retain a copy for future children: the planes' buffers detach when they are transferred. The
 * finest stratum has no children, so its planes are never worth the memory.
 */
export function retain(req: SynthRequest, planes: PlaneSet): void {
  if (req.stratum === 0 && !req.seed) return;
  parents.store(ownKey(req), { Y: planes.Y.slice(), Co: planes.Co.slice(), Cg: planes.Cg.slice() });
}
