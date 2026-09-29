import { PERCENT } from '@/shared/config/constants';
import { REFETCH_WINDOW_MS } from '@/shared/config/eviction';
import { MS_PER_S } from '@/shared/config/units';
import { fmtBytes, fmtMs } from '@/shared/lib/format-units';
import { pending, PENDING, type TelemetryInput, type TelemetrySection } from './types';

const [EVICTED, REFETCHED, MEDIAN] = ['Evicted since open', `Re-sent within ${REFETCH_WINDOW_MS / MS_PER_S} s`, 'Median time to refetch'] as const;
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
