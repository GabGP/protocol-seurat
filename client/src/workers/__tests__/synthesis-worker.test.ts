import { beforeAll, describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { planesKey, STALE_PARENT, type SynthRequest, type SynthResult } from '@/workers/protocol';

/** Deterministic xorshift32 so the golden hashes never drift. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  };
}

function uleb(out: number[], v: number): void {
  let n = v;
  for (;;) {
    const b = n & 0x7f;
    n = Math.floor(n / 128);
    if (n === 0) { out.push(b); return; }
    out.push(b | 0x80);
  }
}

const zig = (n: number): number => (n >= 0 ? 2 * n : -2 * n - 1);

function fnv(...bufs: ArrayBuffer[]): string {
  let h = 0x811c9dc5;
  for (const b of bufs) {
    for (const byte of new Uint8Array(b)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function seedBytes(w: number, h: number, r: () => number): ArrayBuffer {
  const out: number[] = [];
  for (let c = 0; c < 3; c++) for (let i = 0; i < w * h; i++) uleb(out, zig((r() % 41) - 20));
  return new Uint8Array(deflateRawSync(Uint8Array.from(out))).buffer;
}

function bandBytes(nch: number, r: () => number): ArrayBuffer {
  const n = 16384;
  const mask = new Uint8Array(n >> 3);
  for (let i = 0; i < mask.length; i++) mask[i] = r() & r() & 0xff; // ~25% density
  const out: number[] = Array.from(mask);
  for (let c = 0; c < nch; c++) {
    for (let det = 0; det < 3; det++) {
      for (let i = 0; i < n; i++) {
        if (((mask[i >> 3] ?? 0) >> (i & 7)) & 1) uleb(out, zig((r() % 301) - 150));
      }
    }
  }
  return new Uint8Array(deflateRawSync(Uint8Array.from(out))).buffer;
}

function parentPlanes(r: () => number): ArrayBuffer[] {
  return [0, 1, 2].map(() => Int16Array.from({ length: 256 * 256 }, () => (r() % 512) - 128).buffer);
}

const results: SynthResult[] = [];
let onmessage: (ev: { data: SynthRequest }) => Promise<void>;

async function run(req: SynthRequest): Promise<SynthResult> {
  results.length = 0;
  await onmessage({ data: req });
  const out = results[0];
  if (!out) throw new Error('worker posted nothing');
  return out;
}

function base(over: Partial<SynthRequest>): SynthRequest {
  return {
    delivery: 1, synthesisId: 1, stratum: 0, qY: 3, qC: 5, seed: false, seedWidth: 0, seedHeight: 0,
    brush: 'b', edition: 1, bands: [], ...over,
  };
}

beforeAll(async () => {
  const g = globalThis as unknown as { self: unknown };
  g.self = { postMessage: (m: SynthResult) => results.push(m) } as unknown;
  await import('@/workers/synthesis.worker');
  onmessage = (g.self as { onmessage: typeof onmessage }).onmessage;
});

/** Golden hashes were recorded from the pre-optimization decoder: output must be bit-identical. */
describe('synthesis worker decode (golden)', () => {
  it('decodes a seed identically', async () => {
    const r = rng(7);
    const out = await run(base({ seed: true, seedWidth: 13, seedHeight: 9, bands: [seedBytes(13, 9, r)], brush: 'seed' }));
    expect(out.ok).toBe(true);
    expect(fnv(out.rgba as ArrayBuffer, ...(out.planes ?? []))).toBe('94457565');
  });

  it('decodes a 3-band colour brush over a cropped parent identically', async () => {
    const r = rng(42);
    const out = await run(base({
      parentPlanes: parentPlanes(r), parentKey: 'p/1', parentPlaneWidth: 256, parentPlaneHeight: 256,
      parentX: 128, parentY: 0, bands: [bandBytes(3, r), bandBytes(3, r), bandBytes(3, r)], brush: 'c',
    }));
    expect(out.ok).toBe(true);
    expect(fnv(out.rgba as ArrayBuffer, ...(out.planes ?? []))).toBe('8c912ce0');
  });

  it('decodes a luma-only brush from a cached parent ref identically', async () => {
    const r = rng(99);
    const out = await run(base({
      qC: 0, parentRef: 'p/1', parentX: 0, parentY: 128, bands: [bandBytes(1, r)], brush: 'l',
    }));
    expect(out.ok).toBe(true);
    expect(fnv(out.rgba as ArrayBuffer, ...(out.planes ?? []))).toBe('11dd8f53');
  });

  it('serves its own result to a child that refers to it by the main-thread key', async () => {
    const r = rng(5);
    const key = 'own/1'; // brushKey(id, edition); with the synthesis, what the main thread puts in parentRef
    const parent = await run(base({ seed: true, seedWidth: 13, seedHeight: 9, bands: [seedBytes(13, 9, r)], brush: key, synthesisId: 7 }));
    expect(parent.ok).toBe(true);
    const older = await run(base({ qC: 0, parentRef: planesKey(key, 6), bands: [bandBytes(1, r)], brush: 'kid/1' }));
    expect(older.error).toBe(STALE_PARENT); // another synthesis of the brush: other planes
    const child = await run(base({ qC: 0, parentRef: planesKey(key, 7), bands: [bandBytes(1, r)], brush: 'kid/1' }));
    expect(child.ok).toBe(true);
  });

  it('a planes-only decode brings the same planes, no RGBA, and keeps nothing for children', async () => {
    const seed = (): ArrayBuffer => seedBytes(13, 9, rng(11));
    const full = await run(base({ seed: true, seedWidth: 13, seedHeight: 9, bands: [seed()], brush: 'full/1' }));
    const bare = await run(base({ seed: true, seedWidth: 13, seedHeight: 9, bands: [seed()], brush: 'bare/1', planesOnly: true }));
    expect(bare.ok).toBe(true);
    expect(bare.rgba).toBeNull();
    expect(bare.bitmap ?? null).toBeNull();
    expect(fnv(...(bare.planes ?? []))).toBe(fnv(...(full.planes ?? [])));
    const child = await run(base({ qC: 0, parentRef: planesKey('bare/1', 1), bands: [bandBytes(1, rng(3))], brush: 'kid/2' }));
    expect(child.error).toBe(STALE_PARENT);
  });

  it('keeps no planes for a finest-stratum decode: nothing can hang on it', async () => {
    const r = rng(7);
    const seed = await run(base({ seed: true, seedWidth: 13, seedHeight: 9, bands: [seedBytes(13, 9, r)], brush: 'seed/1', cacheEntries: 4 }));
    expect(seed.ok).toBe(true);
    const leaf = await run(base({ qC: 0, parentRef: planesKey('seed/1', 1), bands: [bandBytes(1, r)], brush: 'leaf/1' }));
    expect(leaf.ok).toBe(true);
    const grand = await run(base({ qC: 0, parentRef: planesKey('leaf/1', 1), bands: [bandBytes(1, r)], brush: 'x/1' }));
    expect(grand.error).toBe(STALE_PARENT);
  });
});
