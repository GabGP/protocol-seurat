import { describe, expect, it } from 'vitest';
import { WorkerPool, poolSizeFor } from '../worker-pool';
import { SynthQueue, type ReadyJob } from '../synth-queue';
import type { SynthRequest } from '@/workers/protocol';

function req(delivery: number, stratum: number): SynthRequest {
  return { delivery, synthesisId: delivery, stratum, qY: 4, qC: 6, seed: false, seedWidth: 192, seedHeight: 160,
    brush: `${delivery}/1`, edition: 1, bands: [] };
}

function job(delivery: number, stratum: number, epoch = 1, distTiles = 0): ReadyJob {
  return { req: req(delivery, stratum), brushId: BigInt(delivery), epoch, distTiles, refOk: true };
}

class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: SynthRequest[] = [];
  terminated = false;
  postMessage(r: SynthRequest): void {
    this.sent.push(r);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe('poolSizeFor', () => {
  it('clamps cores-1 into [2, 8]', () => {
    expect(poolSizeFor(undefined)).toBe(3);
    expect(poolSizeFor(1)).toBe(2);
    expect(poolSizeFor(2)).toBe(2);
    expect(poolSizeFor(4)).toBe(3);
    expect(poolSizeFor(9)).toBe(8);
    expect(poolSizeFor(32)).toBe(8);
  });
});

describe('WorkerPool', () => {
  it('dispatches to idle workers, reports full, frees on complete', () => {
    const made: FakeWorker[] = [];
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    });
    expect(pool.idleIndex()).toBe(0);
    pool.send(0, req(1, 10), []);
    expect(pool.idleIndex()).toBe(1);
    expect(made[0]?.sent.length).toBe(1);
    pool.send(1, req(2, 10), []);
    expect(pool.idleIndex()).toBe(-1);
    pool.complete(0);
    expect(pool.idleIndex()).toBe(0);
    expect(() => pool.send(7, req(3, 10), [])).toThrow();
    pool.dispose();
    expect(made.every((w) => w.terminated)).toBe(true);
  });

  it('routes each worker result with its index', () => {
    const made: FakeWorker[] = [];
    const pool = new WorkerPool(2, () => {
      const w = new FakeWorker();
      made.push(w);
      return w;
    });
    const seen: number[] = [];
    pool.onResults((index) => seen.push(index));
    made[1]?.onmessage?.({ data: {} } as MessageEvent);
    made[0]?.onmessage?.({ data: {} } as MessageEvent);
    expect(seen).toEqual([1, 0]);
    pool.dispose();
  });
});

describe('SynthQueue', () => {
  it('pops empty as undefined', () => {
    expect(new SynthQueue().pop()).toBeUndefined();
  });

  it('orders epoch, then stratum, then focus, then delivery, then age', () => {
    const q = new SynthQueue();
    q.push(job(5, 9, 1, 0)); // coarse, old epoch
    q.push(job(1, 0, 2, 99)); // fine and far, but new epoch: first
    q.push(job(3, 9, 1, 4)); // coarse but farther than delivery 5
    q.push(job(2, 9, 1, 4)); // same key as 3, older delivery first
    expect(q.pop()?.req.delivery).toBe(1);
    expect(q.pop()?.req.delivery).toBe(5);
    expect(q.pop()?.req.delivery).toBe(2);
    expect(q.pop()?.req.delivery).toBe(3);
    expect(q.pop()).toBeUndefined();
  });

  it('prefers coarser stratum over nearer fine detail', () => {
    const q = new SynthQueue();
    q.push(job(1, 0, 1, 0));
    q.push(job(2, 5, 1, 50));
    expect(q.pop()?.req.delivery).toBe(2);
  });
});
