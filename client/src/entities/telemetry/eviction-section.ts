import { PERCENT } from '@/shared/config/constants';
import { fmtBytes, fmtMs } from '@/shared/lib/format-units';
import { pending, PENDING, type TelemetryInput, type TelemetrySection } from './types';

const [EVICTED, REFETCHED, MEDIAN] = ['Evicted (count · bytes)', 'Re-sent after evict (count · bytes · % of evicted)', 'Median time to refetch'] as const;
const KEYS = [EVICTED, REFETCHED, MEDIAN];
const TITLE = 'Eviction';

/** What voluntary eviction cost: bricks dropped, and how many the server had to send again. */
export function eviction({ sink }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: TITLE, rows: pending(KEYS) };
  const e = sink.eviction;
  const share = e.evicted > 0 ? Math.round((PERCENT * e.refetched) / e.evicted) : 0;
  return {
    title: TITLE,
    rows: [
      { k: EVICTED, v: `${e.evicted} · ${fmtBytes(e.evictedBytes)}` },
      { k: REFETCHED, v: `${e.refetched} · ${fmtBytes(e.refetchedBytes)} · ${share}%` },
      { k: MEDIAN, v: e.medianRefetchMs === null ? PENDING : fmtMs(e.medianRefetchMs) },
    ],
  };
}
