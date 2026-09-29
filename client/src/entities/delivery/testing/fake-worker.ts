import type { SynthRequest } from '@/workers/protocol';
import type { SynthWorker } from '../worker-pool';

/** A synthesis worker that records its requests and answers only when the test says so. */
export class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  sent: SynthRequest[] = [];
  terminated = false;
  postMessage(req: SynthRequest, _options?: { transfer: Transferable[] }): void {
    this.sent.push(req);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

/** A worker that swallows every request: for tests where synthesis must never finish. */
export const idleWorker = (): SynthWorker => ({ onmessage: null, postMessage() {}, terminate() {} }) as unknown as SynthWorker;
