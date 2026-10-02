import { PROGRESS_THROTTLE_MS } from '@/shared/config/intake-ui';
import { MS_PER_S } from '@/shared/config/units';
import { reasonForStatus } from './reasons';
import type { IntakeAction, IntakeItem } from './types';

export interface RunQueueDeps {
  upload(file: File, onProgress: (sent: number, total: number) => void, signal: AbortSignal): Promise<void>;
  importSource(text: string, signal: AbortSignal): Promise<void>;
  dispatch(action: IntakeAction): void;
  signalFor(key: string): AbortSignal;
  now(): number;
}

function extractError(err: unknown, signal: AbortSignal): string {
  if (signal.aborted || (err as { name?: string })?.name === 'AbortError') {
    return 'Cancelled';
  }
  if (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  ) {
    return reasonForStatus((err as { status: number }).status);
  }
  return 'Connection lost';
}

/** Processes queued intake items strictly one at a time via injected transfer operations. */
export async function runQueue(items: IntakeItem[], deps: RunQueueDeps): Promise<void> {
  const queued = items.filter((it) => it.status === 'queued');

  for (const item of queued) {
    const signal = deps.signalFor(item.key);
    if (signal.aborted) {
      deps.dispatch({ type: 'failed', key: item.key, error: 'Cancelled' });
      continue;
    }

    try {
      if (item.source === 'file') {
        if (!item.file) {
          deps.dispatch({ type: 'failed', key: item.key, error: 'Empty or unreadable request' });
          continue;
        }

        const startTime = deps.now();
        let lastDispatchTime = -Infinity;
        let lastSentBytes = 0;
        let lastTime = startTime;

        const onProgress = (sentBytes: number, totalBytes: number) => {
          const currentTime = deps.now();
          const timeSinceLast = currentTime - lastDispatchTime;
          const isComplete = totalBytes > 0 && sentBytes >= totalBytes;

          if (!isComplete && timeSinceLast < PROGRESS_THROTTLE_MS) {
            return;
          }

          const dt = (currentTime - lastTime) / MS_PER_S;
          const rate = dt > 0 ? Math.max(0, Math.round((sentBytes - lastSentBytes) / dt)) : undefined;
          lastDispatchTime = currentTime;
          lastTime = currentTime;
          lastSentBytes = sentBytes;

          const sent = totalBytes > 0 ? Math.min(1, Math.max(0, sentBytes / totalBytes)) : 0;
          deps.dispatch({ type: 'progress', key: item.key, sent, rate });
        };

        await deps.upload(item.file, onProgress, signal);
      } else {
        deps.dispatch({ type: 'waiting', key: item.key });
        await deps.importSource(item.label, signal);
      }

      deps.dispatch({ type: 'accepted', key: item.key });
    } catch (err: unknown) {
      const error = extractError(err, signal);
      deps.dispatch({ type: 'failed', key: item.key, error });
    }
  }
}
