import { DeliverySink } from '../sink/delivery-sink';
import type { DeliveryPort } from '../sink/port';
import { fakeClient } from './fake-port';
import { FakeWorker } from './fake-worker';

const HANDLE = 1;
const DEFAULT_MAX_KIB = 36864;
const DEFAULT_MAX_BRUSHES = 768;
const SEED_W = 192;
const SEED_H = 160;
const SEED_STRATA = 11;

export interface SinkOpts {
  client?: DeliveryPort;
  maxKiB?: number;
  maxBrushes?: number;
  /** Worker pool size; giving it (or `workers`) builds the pool explicitly. */
  poolSize?: number;
  /** Collects the FakeWorkers the pool spawns; without it the sink spawns its default workers. */
  workers?: FakeWorker[];
}

/** A DeliverySink over fakes, with the loan-book limits every sink test shares unless it overrides them. */
export function makeSink(o: SinkOpts = {}): DeliverySink {
  const client = o.client ?? fakeClient();
  const base = [HANDLE, () => client, () => o.maxKiB ?? DEFAULT_MAX_KIB, () => o.maxBrushes ?? DEFAULT_MAX_BRUSHES] as const;
  if (o.poolSize === undefined && !o.workers) return new DeliverySink(...base);
  const workers = o.workers;
  return new DeliverySink(...base, SEED_W, SEED_H, SEED_STRATA, o.poolSize ?? 1, workers
    ? () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    }
    : undefined);
}
