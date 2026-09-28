import { describe, expect, it } from 'vitest';
import { finishRegion, type FinishRequest } from '@/workers/preview-finish';
import { planesToRgba } from '@/workers/planes-rgba';
import { shrinkTo } from '@/workers/plane-shrink';
import { PreviewFinisher, type FinishWorker } from '../model/preview-finisher';

const level = () => ({
  planes: [100, 4, -6].map((v) => Int16Array.from({ length: 8 * 4 }, (_, i) => v + (i % 8))),
  width: 8,
  height: 4,
});
const whole = { x: 0, y: 0, w: 8, h: 4 };

/** The whole level at 4 × 2, finished in one pass. */
function expected(): Uint8ClampedArray {
  const [Y, Co, Cg] = shrinkTo(level(), 4).planes;
  return planesToRgba(Y!, Co!, Cg!, 8);
}

/** A worker that runs the real finishing pass when told to, or fails. */
function fakeWorker(): { worker: FinishWorker; answer: () => void; crash: () => void; sent: FinishRequest[] } {
  const sent: FinishRequest[] = [];
  const worker: FinishWorker = {
    postMessage: (req) => sent.push(req),
    terminate: () => {},
    onmessage: null,
    onerror: null,
  };
  const answer = (): void => {
    const req = sent.shift();
    if (!req) return;
    const rgba = finishRegion(req, req.planes.map((b) => new Int16Array(b)));
    worker.onmessage?.({ data: { id: req.id, rgba: rgba.buffer } } as MessageEvent);
  };
  const crash = (): void => worker.onerror?.({} as ErrorEvent);
  return { worker, answer, crash, sent };
}

describe('PreviewFinisher', () => {
  it('finishes in the worker exactly as on the main thread, leaving the level to the caller', async () => {
    const f = fakeWorker();
    const src = level();
    const out = new PreviewFinisher(() => f.worker).finish(src, 4, 2, whole);
    expect(f.sent[0]).toMatchObject({ levelWidth: 8, levelHeight: 4, width: 4, height: 2, out: { x: 0, y: 0, w: 4, h: 2 } });
    f.answer();
    const got = await out;
    expect(got.rect).toEqual({ x: 0, y: 0, w: 4, h: 2 });
    expect(Array.from(got.rgba)).toEqual(Array.from(expected()));
    expect(src.planes[0]?.length).toBe(32);
  });

  it('finishes only the part of the card a changed part of the level reaches', async () => {
    const got = await new PreviewFinisher(() => null).finish(level(), 4, 2, { x: 6, y: 0, w: 2, h: 1 });
    expect(got.rect).toEqual({ x: 2, y: 0, w: 2, h: 2 });
    const all = expected();
    const part = [0, 1].flatMap((y) => Array.from(all.subarray((y * 4 + 2) * 4, (y * 4 + 4) * 4)));
    expect(Array.from(got.rgba)).toEqual(part);
  });

  it('finishes on the main thread when there is no worker', async () => {
    const got = await new PreviewFinisher(() => null).finish(level(), 4, 2, whole);
    expect(Array.from(got.rgba)).toEqual(Array.from(expected()));
  });

  it('fails what a crashed worker held and finishes later ones on the main thread', async () => {
    const f = fakeWorker();
    let made = 0;
    const finisher = new PreviewFinisher(() => (made++, f.worker));
    const lost = finisher.finish(level(), 4, 2, whole);
    f.crash();
    await expect(lost).rejects.toThrow();
    await expect(finisher.finish(level(), 4, 2, whole)).resolves.toMatchObject({ rect: { w: 4, h: 2 } });
    expect(made).toBe(1);
  });
});
