import { fmtBytes } from '@/shared/lib/format-units';
import type { TabMemory } from '@/shared/lib/memory-split';
import { pending, type TelemetryRow } from './types';

/** The rows the browser's own tab measurement fills: what Chrome's Task Manager and DevTools count, not our estimate. */
export const TAB_KEY = 'Tab (measured)';
export const TAB_SPLIT_KEY = 'Page · workers';

/**
 * `undefined` = the browser cannot measure (no rows); `null` = not measured yet (placeholders that keep both rows' place).
 */
export function tabMemoryRows(tab: TabMemory | null | undefined): TelemetryRow[] {
  if (tab === undefined) return [];
  if (tab === null) return pending([TAB_KEY, TAB_SPLIT_KEY]);
  return [
    { k: TAB_KEY, v: fmtBytes(tab.total) },
    { k: TAB_SPLIT_KEY, v: `${fmtBytes(tab.page)} · ${fmtBytes(tab.workers)}` },
  ];
}
