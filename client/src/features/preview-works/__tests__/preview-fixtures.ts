import { deflateRawSync } from 'node:zlib';
import { makeBrushId } from '@/shared/proto/brush';
import { makeDeliveryBytes } from '@/shared/proto/testing/brush-bytes';
import { ulebEncode, zigzagEncode } from '@/shared/codec/leb128';
import { rgbToYCoCg } from '@/shared/codec/ycocgr';
import type { SynthWorker, WorkerFactory } from '@/entities/delivery';
import type { SynthRequest, SynthResult } from '@/workers/protocol';
import { PREVIEW_RECOMPOSE_GAP_MS } from '@/shared/config/constants';
import type { WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/entities/session';
import { PreviewManager } from '../model/preview-manager';

/** A PINCELADA flow carrying one band: 0 by default (bandas 0x01), or `(from << 4) | through`. */
function flow(handle: number, delivery: number, brushId: bigint, band: Uint8Array, bands = 0x01): Uint8Array {
  return makeDeliveryBytes({ handle, delivery, brushId, from: bands >> 4, through: bands & 0xf, epoch: 1, qY: 1, qC: 1, band });
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

/** Lets queued decodes and a waiting recompose finish (the inline worker answers on later ticks). */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, PREVIEW_RECOMPOSE_GAP_MS + 50));

/** A 300 × 4 seed under a work of 11 strata: stratum 9 has 3 × 1 brushes under it, stratum 8 has 5 × 1. */
export const opened = (handle: number, seedWidth = 300, seedHeight = 4, strata = 11): WorkOpened => ({
  handle, width: 76_800, height: 1024, strata, edition: 1, ceilingStratum: 10, ceilingBands: 4, seedWidth, seedHeight,
});

export function recorder(workers = inlineWorkers) {
  const log = {
    opened: [] as string[], closed: [] as number[], receipts: [] as Array<{ completed: number[]; free: number }>,
    released: [] as Array<{ reason: number; ranges: number[] }>, scraped: [] as Array<{ count: number; kept: number[] }>,
    inventory: [] as number[][], gazes: [] as Array<Record<string, number>>,
  };
  const client = {
    openPreview: (id: string) => log.opened.push(id),
    closeHandle: (h: number) => log.closed.push(h),
    sendGazeReliable: (g: Record<string, number>) => log.gazes.push(g),
    sendReceipt: (_h: number, completed: number[], _q: number, free: number) => log.receipts.push({ completed, free }),
    sendRelease: (_h: number, reason: number, ranges: number[]) => log.released.push({ reason, ranges }),
    sendScraped: (...a: unknown[]) => log.scraped.push({ count: a[4] as number, kept: a[6] as number[] }),
    sendInventory: (...a: unknown[]) => log.inventory.push(a[5] as number[]),
  } as unknown as SessionClient;
  return { log, manager: new PreviewManager(() => client, workers) };
}
