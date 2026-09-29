import { WorkerPool } from '../worker-pool';
import type { ReadyJob } from '../synth-queue';
import type { SynthRequest } from '@/workers/protocol';
import { distTiles } from './synth-request';
import type { SinkState } from './state';

function ensurePool(s: SinkState): WorkerPool {
  if (s.pool) return s.pool;
  const pool = new WorkerPool(s.poolSize, s.createWorker);
  pool.onResults((index, ev) => s.hooks.result(index, ev));
  s.decode.setParallelism(pool.size);
  s.pool = pool;
  return pool;
}

/** A synthesis whose parents are done: claim its identity, queue it, run what fits. */
export function enqueue(s: SinkState, req: SynthRequest, brushId: bigint, epoch: number, refOk = true): void {
  s.activeSynthesis.set(req.delivery, req.synthesisId);
  s.ready.push({ req, brushId, epoch, distTiles: distTiles(s, brushId), refOk });
  s.decode.setWaiting(s.ready.size);
  pump(s);
}

/**
 * Sticky when the parent's worker is free: its plane cache likely still holds the parent, so the
 * child goes by reference and skips the transfer. Bytes go otherwise (and populate that worker's
 * cache under the parent key).
 */
function pickWorker(s: SinkState, pool: WorkerPool, job: ReadyJob): number {
  if (job.refOk && job.req.parentKey !== undefined) {
    const pref = s.origin.get(job.req.parentKey);
    if (pref !== undefined && pool.isIdle(pref)) {
      job.req.parentRef = job.req.parentKey;
      job.req.parentPlanes = undefined;
      return pref;
    }
  }
  const idle = pool.idleIndex();
  if (idle < 0) throw new Error('no idle synthesis worker');
  return idle;
}

/** Post ready jobs to idle workers; drop jobs whose delivery died waiting. */
export function pump(s: SinkState): void {
  if (s.ready.size === 0) return;
  const pool = ensurePool(s);
  for (;;) {
    if (pool.idleIndex() < 0) break;
    const job = s.ready.pop();
    if (!job) break;
    if (!s.book.byDelivery.has(job.req.delivery)) continue;
    if (s.activeSynthesis.get(job.req.delivery) !== job.req.synthesisId) continue;
    try {
      const index = pickWorker(s, pool, job);
      const transfers = [...job.req.bands];
      if (job.req.parentPlanes) transfers.push(...job.req.parentPlanes);
      pool.send(index, job.req, transfers);
      s.inflight.set(job.req.delivery, { req: job.req, brushId: job.brushId, epoch: job.epoch });
      s.decode.posted();
    } catch {
      s.inflight.delete(job.req.delivery);
      s.hooks.fail(job.req.delivery);
    }
  }
  s.decode.setWaiting(s.ready.size);
}
