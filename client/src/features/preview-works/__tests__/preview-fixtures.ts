import { deflateRawSync } from 'node:zlib';
import { makeBrushId } from '@/shared/proto/brush';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { ulebEncode, zigzagEncode } from '@/shared/codec/leb128';
import { rgbToYCoCg } from '@/shared/codec/ycocgr';
import type { SynthWorker, WorkerFactory } from '@/entities/delivery/worker-pool';
import type { SynthRequest, SynthResult } from '@/workers/protocol';

/** A PINCELADA flow carrying one band: 0 by default (bandas 0x01), or `(from << 4) | through`. */
function flow(handle: number, delivery: number, brushId: bigint, band: Uint8Array, bands = 0x01): Uint8Array {
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, brushId);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32c(band));
  return concat(
    viEncode(0x01), viEncode(handle), viEncode(delivery), id, [bands], viEncode(1), [1, 1], viEncode(1),
    crc, viEncode(band.length), band,
  );
}

/** A flat-colour seed of `w × h` (DPCM + zigzag + LEB128 + deflate, spec 3.4.4). */
export function seedDelivery(handle: number, delivery: number, w: number, h: number): Uint8Array {
  const { y, co, cg } = rgbToYCoCg(120, 140, 200);
  const raw: number[] = [];
  for (const v of [y, co, cg]) {
    for (let row = 0; row < h; row++) {
      raw.push(...ulebEncode(zigzagEncode(v)));
      for (let x = 1; x < w; x++) raw.push(0);
    }
  }
  return flow(handle, delivery, makeBrushId(10, 0, 0), deflateRawSync(Uint8Array.from(raw)));
}

/** A brush whose band carries no detail (all-zero significance mask): band 0 unless `bands` says otherwise. */
export function brushDelivery(
  handle: number, delivery: number, stratum: number, bx: number, by: number, bands = 0x01,
): Uint8Array {
  return flow(handle, delivery, makeBrushId(stratum, bx, by), deflateRawSync(new Uint8Array(16384 >> 3)), bands);
}

let current: SynthWorker | null = null;
let loaded: Promise<(ev: { data: SynthRequest }) => Promise<void>> | null = null;

/** The real synthesis worker, run in this thread: its `self` posts back to the worker handed out last. */
function workerModule(): Promise<(ev: { data: SynthRequest }) => Promise<void>> {
  loaded ??= (async () => {
    const g = globalThis as unknown as { self: unknown };
    g.self = { postMessage: (m: SynthResult) => current?.onmessage?.({ data: m } as MessageEvent) } as unknown;
    await import('@/workers/synthesis.worker');
    return (g.self as { onmessage: (ev: { data: SynthRequest }) => Promise<void> }).onmessage;
  })();
  return loaded;
}

export const inlineWorkers: WorkerFactory = () => {
  const w: SynthWorker = {
    onmessage: null,
    postMessage: (req) => void workerModule().then((run) => run({ data: req })),
    terminate: () => {
      if (current === w) current = null;
    },
  };
  current = w;
  return w;
};

/** Lets queued decodes finish (the inline worker answers on later ticks). */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));
