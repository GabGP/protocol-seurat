import { describe, expect, it } from 'vitest';
import { finishPlanes, type FinishRequest } from '@/workers/preview-finish';
import { PreviewFinisher, type FinishWorker } from '../model/preview-finisher';

const level = () => ({
  planes: [100, 4, -6].map((v) => Int16Array.from({ length: 8 * 4 }, (_, i) => v + (i % 8))),
  width: 8,
  height: 4,
});

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
    const done = finishPlanes({ planes: req.planes.map((b) => new Int16Array(b)), width: req.width, height: req.height }, req.shownWidth);
    worker.onmessage?.({ data: { id: req.id, rgba: done.rgba.buffer, width: done.width, height: done.height } } as MessageEvent);
  };
  const crash = (): void => worker.onerror?.({} as ErrorEvent);
  return { worker, answer, crash, sent };
}

describe('PreviewFinisher', () => {
  it('finishes in the worker exactly as on the main thread', async () => {
    const f = fakeWorker();
    const finisher = new PreviewFinisher(() => f.worker);
    const expected = finishPlanes(level(), 4);
    const out = finisher.finish(level(), 4);
    expect(f.sent[0]).toMatchObject({ width: 8, height: 4, shownWidth: 4 });
    f.answer();
    const got = await out;
    expect(got).toMatchObject({ width: 4, height: 2 });
    expect(Array.from(got.rgba)).toEqual(Array.from(expected.rgba));
  });

  it('finishes on the main thread when there is no worker', async () => {
    const got = await new PreviewFinisher(() => null).finish(level(), 4);
    expect(Array.from(got.rgba)).toEqual(Array.from(finishPlanes(level(), 4).rgba));
  });

  it('fails what a crashed worker held and finishes later ones on the main thread', async () => {
    const f = fakeWorker();
    let made = 0;
    const finisher = new PreviewFinisher(() => (made++, f.worker));
    const lost = finisher.finish(level(), 4);
    f.crash();
    await expect(lost).rejects.toThrow();
    await expect(finisher.finish(level(), 4)).resolves.toMatchObject({ width: 4, height: 2 });
    expect(made).toBe(1);
  });
});
