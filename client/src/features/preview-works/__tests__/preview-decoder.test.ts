import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewDecoder, type DecodeRequest } from '../model/preview-decoder';
import { PREVIEW_DECODE_TIMEOUT_MS } from '@/shared/config/constants';
import type { SynthWorker } from '@/entities/delivery';
import type { SynthRequest } from '@/workers/protocol';

const REQ: DecodeRequest = {
  delivery: 1, stratum: 9, qY: 1, qC: 1, seed: false, seedWidth: 0, seedHeight: 0, brush: 'b', edition: 1, bands: [],
};

/** Workers that never answer by themselves: each records what it was asked and can reply or crash. */
function fakeWorkers() {
  const made: Array<SynthWorker & { asked: SynthRequest[]; ended: boolean }> = [];
  const factory = () => {
    const w = {
      asked: [] as SynthRequest[], ended: false, onmessage: null, onerror: null, onmessageerror: null,
      postMessage: (req: SynthRequest) => void w.asked.push(req),
      terminate: () => void (w.ended = true),
    } as SynthWorker & { asked: SynthRequest[]; ended: boolean };
    made.push(w);
    return w;
  };
  const reply = (w: SynthWorker, req: SynthRequest | undefined) => w.onmessage?.({
    data: { delivery: 1, synthesisId: req?.synthesisId, ok: true, rgba: null, planes: [new ArrayBuffer(2)], width: 1, height: 1, elapsedMs: 0 },
  } as MessageEvent);
  return { made, factory, reply };
}

describe('PreviewDecoder', () => {
  afterEach(() => vi.useRealTimers());

  it('spreads decodes over a few workers', async () => {
    const { made, factory, reply } = fakeWorkers();
    const decoder = new PreviewDecoder(factory);
    const done = [decoder.decode(REQ), decoder.decode(REQ)];
    expect(made.length).toBeGreaterThanOrEqual(2);
    for (const w of made) for (const r of w.asked) reply(w, r);
    await expect(Promise.all(done)).resolves.toHaveLength(2);
    decoder.dispose();
  });

  it('fails only what a crashed worker held, and decodes on a new one after', async () => {
    const { made, factory, reply } = fakeWorkers();
    const decoder = new PreviewDecoder(factory);
    const lost = decoder.decode(REQ);
    const crashed = made[0];
    crashed?.onerror?.({} as ErrorEvent);
    await expect(lost).rejects.toThrow('worker failed');
    expect(crashed?.ended).toBe(true);

    const next = decoder.decode(REQ);
    const fresh = made.at(-1);
    expect(fresh).not.toBe(crashed);
    if (fresh) reply(fresh, fresh.asked[0]);
    await expect(next).resolves.toMatchObject({ width: 1, height: 1 });
    decoder.dispose();
  });

  it('ends a worker that misses the deadline', async () => {
    vi.useFakeTimers();
    const { made, factory } = fakeWorkers();
    const decoder = new PreviewDecoder(factory);
    const stuck = decoder.decode(REQ);
    vi.advanceTimersByTime(PREVIEW_DECODE_TIMEOUT_MS);
    await expect(stuck).rejects.toThrow('timed out');
    expect(made[0]?.ended).toBe(true);
    decoder.dispose();
  });

  it('rejects whatever is pending when closed', async () => {
    const { made, factory } = fakeWorkers();
    const decoder = new PreviewDecoder(factory);
    const pending = decoder.decode(REQ);
    decoder.dispose();
    await expect(pending).rejects.toThrow('closed');
    expect(made.every((w) => w.ended)).toBe(true);
  });
});
