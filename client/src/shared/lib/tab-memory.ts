import { TAB_MEMORY_POLL_MS } from '../config/memory';
import { splitMeasurement, type MemoryMeasurement, type TabMemory } from './memory-split';

interface MeasuringPerformance {
  measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>;
}

let last: TabMemory | null = null;
let watchers = 0;
let timer: number | undefined;
let running = false;

/** The browser measures a tab's memory only in a cross-origin isolated page (the server sends COOP/COEP for it). */
export function tabMemorySupported(): boolean {
  return globalThis.crossOriginIsolated === true
    && typeof (performance as MeasuringPerformance).measureUserAgentSpecificMemory === 'function';
}

/** The latest measurement, or null before the first one resolves. */
export function tabMemory(): TabMemory | null {
  return last;
}

async function measureOnce(): Promise<void> {
  try {
    const m = await (performance as MeasuringPerformance).measureUserAgentSpecificMemory?.();
    if (m) last = splitMeasurement(m);
  } catch {
    // Not measurable right now (a SecurityError while isolation is lost, or a busy tab): keep the last value.
  }
}

/** One loop at a time: a measurement in flight, or the wait before the next. */
async function loop(): Promise<void> {
  running = true;
  await measureOnce();
  if (watchers > 0) timer = window.setTimeout(() => void loop(), TAB_MEMORY_POLL_MS);
  else running = false;
}

/** Starts measuring while something shows the figure; the returned function stops it. Calls never overlap. */
export function watchTabMemory(): () => void {
  if (!tabMemorySupported()) return () => undefined;
  watchers += 1;
  if (!running) void loop();
  return () => {
    watchers = Math.max(0, watchers - 1);
    if (watchers === 0 && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      running = false;
    }
  };
}
