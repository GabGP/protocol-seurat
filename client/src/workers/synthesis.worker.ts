import type { SynthRequest, SynthResult } from './protocol';
import { STALE_PARENT, SYNTH_CACHE_GHOST, SYNTH_CACHE_MAIN, SYNTH_CACHE_SMALL } from './protocol';
import { ParentPlaneCache, type PlaneSet } from './synth-cache';

/** Parent planes this worker synthesized or received: ref hits skip transfers. */
const parents = new ParentPlaneCache(SYNTH_CACHE_SMALL, SYNTH_CACHE_MAIN, SYNTH_CACHE_GHOST);

/** Cache identity: `req.brush` already is the `${brush}/${edition}` key the main thread refers to. */
function ownKey(req: SynthRequest): string {
  return req.brush;
}

/**
 * Read cursor for `uleb`: a module-level index keeps the hot decode loops allocation-free.
 * Every decode loop resets it after its last `await`, so interleaved messages never share it.
 */
let cur = 0;

function uleb(bytes: Uint8Array): number {
  let v = 0;
  let sh = 0;
  for (;;) {
    const b = bytes[cur++];
    if (b === undefined) throw new Error('uleb truncated');
    v += (b & 0x7f) * 2 ** sh;
    if ((b & 0x80) === 0) return v;
    sh += 7;
  }
}

function zz(n: number): number {
  return (n & 1) === 0 ? n / 2 : -((n + 1) / 2);
}

function deq(i: number, q: number): number {
  if (i === 0 || q <= 0) return 0;
  const s = i > 0 ? 1 : -1;
  return s * (Math.abs(i) * q + Math.floor(q / 2));
}


function cropInto(source: Int16Array, width: number, height: number, x0: number, y0: number, target: Int16Array): void {
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      const sx = Math.min(width - 1, x0 + x);
      const sy = Math.min(height - 1, y0 + y);
      target[y * 128 + x] = source[sy * width + sx] ?? 0;
    }
  }
}

function cropGeometry(req: SynthRequest): { width: number; height: number; x0: number; y0: number } {
  return {
    width: req.parentPlaneWidth ?? 256,
    height: req.parentPlaneHeight ?? 256,
    x0: req.parentX ?? 0,
    y0: req.parentY ?? 0,
  };
}

function loadParentPlanes(req: SynthRequest, parentPlanes: Record<'Y' | 'Co' | 'Cg', Int16Array>): void {
  if (!req.parentPlanes) return;
  const { width, height, x0, y0 } = cropGeometry(req);
  const names = ['Y', 'Co', 'Cg'] as const;
  for (let c = 0; c < names.length; c++) {
    const name = names[c];
    if (!name) continue;
    const source = new Int16Array(req.parentPlanes[c] ?? new ArrayBuffer(0));
    cropInto(source, width, height, x0, y0, parentPlanes[name]);
  }
}

/** Crop cached full planes with the same geometry the bytes path would use. */
function loadCachedPlanes(hit: PlaneSet, req: SynthRequest, parentPlanes: Record<'Y' | 'Co' | 'Cg', Int16Array>): void {
  const { width, height, x0, y0 } = cropGeometry(req);
  cropInto(hit.Y, width, height, x0, y0, parentPlanes.Y);
  cropInto(hit.Co, width, height, x0, y0, parentPlanes.Co);
  cropInto(hit.Cg, width, height, x0, y0, parentPlanes.Cg);
}

function snapshot(planes: Record<'Y' | 'Co' | 'Cg', Int16Array>): PlaneSet {
  return { Y: planes.Y.slice(), Co: planes.Co.slice(), Cg: planes.Cg.slice() };
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

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  const p = new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let n = 0;
    const r = ds.readable.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          chunks.push(value);
          n += value.length;
        }
        const out = new Uint8Array(n);
        let o = 0;
        for (const c of chunks) {
          out.set(c, o);
          o += c.length;
        }
        resolve(out);
      } catch (e) {
        reject(e);
      }
    })();
  });
  await w.write(data as unknown as Uint8Array<ArrayBuffer>);
  await w.close();
  return p;
}

async function toBitmap(rgba: Uint8ClampedArray, w: number, h: number): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') return null;
  try {
    return await createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h));
  } catch {
    return null;
  }
}

function miss(req: SynthRequest, t0: number): void {
  const out: SynthResult = {
    delivery: req.delivery,
    synthesisId: req.synthesisId,
    ok: false,
    error: STALE_PARENT,
    rgba: null,
    planes: null,
    width: 0,
    height: 0,
    elapsedMs: performance.now() - t0,
  };
  self.postMessage(out);
}

self.onmessage = async (ev: MessageEvent<SynthRequest>) => {
  const t0 = performance.now();
  const req = ev.data;
  try {
    const w = req.seed ? req.seedWidth : 256;
    const h = req.seed ? req.seedHeight : 256;
    const px = w * h;
    const planes: Record<'Y' | 'Co' | 'Cg', Int16Array> = {
      Y: new Int16Array(px),
      Co: new Int16Array(px),
      Cg: new Int16Array(px),
    };

    if (req.seed) {
      const raw = await inflateRaw(new Uint8Array(req.bands[0] ?? new ArrayBuffer(0)));
      cur = 0;
      for (const ch of ['Y', 'Co', 'Cg'] as const) {
        const pl = planes[ch];
        for (let y = 0; y < h; y++) {
          let left = 0;
          for (let x = 0; x < w; x++) {
            left += zz(uleb(raw));
            pl[y * w + x] = left;
          }
        }
      }
    } else {
      const parentPlanes: Record<'Y' | 'Co' | 'Cg', Int16Array> = {
        Y: new Int16Array(16384),
        Co: new Int16Array(16384),
        Cg: new Int16Array(16384),
      };
      if (req.parentRef !== undefined) {
        const hit = parents.fetch(req.parentRef);
        if (!hit) {
          miss(req, t0);
          return;
        }
        loadCachedPlanes(hit, req, parentPlanes);
      } else {
        loadParentPlanes(req, parentPlanes);
        cacheBytes(req);
      }
      const n = 16384;
      const nch = req.qC > 0 ? 3 : 1;
      const chNames = ['Y', 'Co', 'Cg'] as const;
      const details: [
        [Int32Array, Int32Array, Int32Array],
        [Int32Array, Int32Array, Int32Array],
        [Int32Array, Int32Array, Int32Array],
      ] = [
        [new Int32Array(n), new Int32Array(n), new Int32Array(n)],
        [new Int32Array(n), new Int32Array(n), new Int32Array(n)],
        [new Int32Array(n), new Int32Array(n), new Int32Array(n)],
      ];

      for (let b = 0; b < req.bands.length; b++) {
        const bandBytes = req.bands[b];
        if (!bandBytes || bandBytes.byteLength === 0) continue;
        const raw = await inflateRaw(new Uint8Array(bandBytes));
        const maskOffset = 0;
        cur = n >> 3;
        for (let c = 0; c < nch; c++) {
          const qq = c === 0 ? req.qY : req.qC;
          for (let det = 0; det < 3; det++) {
            const out = details[c]?.[det];
            if (!out) continue;
            for (let i = 0; i < n; i++) {
              const maskByte = raw[maskOffset + (i >> 3)] ?? 0;
              if (((maskByte >> (i & 7)) & 1) === 1) {
                out[i] = deq(zz(uleb(raw)), qq);
              }
            }
          }
        }
      }

      for (let c = 0; c < 3; c++) {
        const chName = chNames[c];
        if (!chName) continue;
        const pl = planes[chName];
        const p = parentPlanes[chName];
        const hVals = details[c]?.[0];
        const vVals = details[c]?.[1];
        const dVals = details[c]?.[2];
        for (let py = 0; py < 128; py++) {
          const yPrev = py === 0 ? 0 : -128;
          const yNext = py === 127 ? 0 : 128;
          for (let pxCoord = 0; pxCoord < 128; pxCoord++) {
            const xPrev = pxCoord === 0 ? 0 : -1;
            const xNext = pxCoord === 127 ? 0 : 1;
            const idx = py * 128 + pxCoord;
            const hHat = ((p[idx + xPrev] ?? 0) - (p[idx + xNext] ?? 0) + 2) >> 2;
            const vHat = ((p[idx + yPrev] ?? 0) - (p[idx + yNext] ?? 0) + 2) >> 2;
            const hVal = (hVals?.[idx] ?? 0) + hHat;
            const vVal = (vVals?.[idx] ?? 0) + vHat;
            const dVal = dVals?.[idx] ?? 0;
            const parent = p[idx] ?? 0;
            const l1 = parent + ((vVal + 1) >> 1);
            const l2 = l1 - vVal;
            const h1 = hVal + ((dVal + 1) >> 1);
            const h2 = h1 - dVal;
            const a = l1 + ((h1 + 1) >> 1);
            const b = a - h1;
            const cc = l2 + ((h2 + 1) >> 1);
            const dd = cc - h2;
            const row0 = (2 * py) * 256 + 2 * pxCoord;
            const row1 = (2 * py + 1) * 256 + 2 * pxCoord;
            pl[row0] = a;
            pl[row0 + 1] = b;
            pl[row1] = cc;
            pl[row1 + 1] = dd;
          }
        }
      }
    }

    // Retain a copy for future children: the transferred buffers detach below.
    parents.store(ownKey(req), snapshot(planes));

    const rgba = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) {
      const y = planes.Y[i] ?? 0;
      const co = planes.Co[i] ?? 0;
      const cg = planes.Cg[i] ?? 0;
      const t = y - (cg >> 1);
      const g = cg + t;
      const b = t - (co >> 1);
      const off = i * 4;
      rgba[off] = b + co;
      rgba[off + 1] = g;
      rgba[off + 2] = b;
      rgba[off + 3] = 255;
    }

    // Build the bitmap here, not on the main thread (it copies + decodes there); bytes are the fallback.
    const bitmap = await toBitmap(rgba, w, h);
    const out: SynthResult = {
      delivery: req.delivery,
      synthesisId: req.synthesisId,
      ok: true,
      rgba: bitmap ? null : (rgba.buffer as ArrayBuffer),
      bitmap,
      planes: [
        planes.Y.buffer as ArrayBuffer,
        planes.Co.buffer as ArrayBuffer,
        planes.Cg.buffer as ArrayBuffer,
      ],
      width: w,
      height: h,
      elapsedMs: performance.now() - t0,
    };
    const moved: Transferable[] = [...(out.planes ?? [])];
    if (out.rgba) moved.push(out.rgba);
    if (bitmap) moved.push(bitmap);
    self.postMessage(out, { transfer: moved });
  } catch (e) {
    const out: SynthResult = {
      delivery: req.delivery,
      synthesisId: req.synthesisId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      rgba: null,
      planes: null,
      width: 0,
      height: 0,
      elapsedMs: performance.now() - t0,
    };
    self.postMessage(out);
  }
};
