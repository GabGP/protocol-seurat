import { SCOPE_WINDOW, SCOPE_WORKER_SUFFIX } from '../config/memory';

/** What the browser measured for the whole tab, in bytes, and how much of it the page and its workers own. */
export interface TabMemory {
  total: number;
  page: number;
  workers: number;
}

/** The subset of the `measureUserAgentSpecificMemory()` result this viewer reads. */
export interface MemoryMeasurement {
  bytes: number;
  breakdown: Array<{ bytes: number; attribution: Array<{ scope?: string }> }>;
}

/** Splits a measurement by owner; memory the browser does not attribute stays in `total` only. */
export function splitMeasurement(m: MemoryMeasurement): TabMemory {
  let page = 0;
  let workers = 0;
  for (const entry of m.breakdown) {
    const scope = entry.attribution[0]?.scope ?? '';
    if (scope === SCOPE_WINDOW) page += entry.bytes;
    else if (scope.endsWith(SCOPE_WORKER_SUFFIX)) workers += entry.bytes;
  }
  return { total: m.bytes, page, workers };
}
