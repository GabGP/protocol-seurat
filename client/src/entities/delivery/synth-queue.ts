import type { SynthRequest } from '@/workers/protocol';

/** A synthesis ready to run the moment a worker is free. */
export interface ReadyJob {
  req: SynthRequest;
  brushId: bigint;
  epoch: number;
  /** Focus distance in tiles: nearer paints first. */
  distTiles: number;
}

interface Entry {
  job: ReadyJob;
  seq: number;
}

/**
 * Priority index over ready syntheses: new epoch first (it never waits for old
 * settle), then coarser stratum (unblocks children), then focus, delivery, age.
 */
export class SynthQueue {
  private readonly heap: Entry[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.heap.length;
  }

  push(job: ReadyJob): void {
    const h = this.heap;
    h.push({ job, seq: this.nextSeq++ });
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const child = h[i];
      const parent = h[p];
      if (child === undefined || parent === undefined || !first(child, parent)) break;
      h[i] = parent;
      h[p] = child;
      i = p;
    }
  }

  pop(): ReadyJob | undefined {
    const h = this.heap;
    const top = h[0];
    if (top === undefined) return undefined;
    const last = h.pop();
    if (last !== undefined && h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let best = i;
        const cur = h[best];
        const l = h[left];
        if (l !== undefined && cur !== undefined && first(l, cur)) best = left;
        const b = h[best];
        const r = h[right];
        if (r !== undefined && b !== undefined && first(r, b)) best = right;
        if (best === i) break;
        const a = h[i];
        const c = h[best];
        if (a === undefined || c === undefined) break;
        h[i] = c;
        h[best] = a;
        i = best;
      }
    }
    return top.job;
  }

  clear(): void {
    this.heap.length = 0;
  }
}

/** True when a pops before b. */
function first(a: Entry, b: Entry): boolean {
  return (
    a.job.epoch - b.job.epoch ||
    a.job.req.stratum - b.job.req.stratum ||
    b.job.distTiles - a.job.distTiles ||
    b.job.req.delivery - a.job.req.delivery ||
    b.seq - a.seq
  ) > 0;
}
