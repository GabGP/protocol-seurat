import type { TabMemory } from '@/shared/lib/memory-split';
import type { RateMeter } from '@/shared/lib/rate-meter';
import type { Concession } from '@/shared/proto/messages';
import type { ImageTelemetry } from './image-telemetry';

export interface TelemetryRow {
  k: string;
  v: string;
}

export interface TelemetrySection {
  title: string;
  rows: TelemetryRow[];
}

/** One held delivery, as telemetry counts it. */
export interface HeldBrush {
  stratum: number;
  bytes: number;
  rgba: { width: number; height: number } | null;
  /** Retained parent planes (YCoCg-R), when the brush kept them. */
  planes?: ArrayBuffer[] | null;
}

/** What eviction has cost this session (DeliverySink.eviction satisfies it). */
export interface EvictionFigures {
  evicted: number;
  evictedBytes: number;
  refetched: number;
  refetchedBytes: number;
  medianRefetchMs: number | null;
}

/** The part of the delivery sink telemetry reads (DeliverySink satisfies it). */
export interface HeldBrushes {
  book: { byDelivery: Map<number, HeldBrush>; inFlight: Set<number> };
  free(): number;
  /** Brushes held: distinct brush+edition, however many deliveries each took (spec 4.1 c). */
  heldBrushes(): number;
  /** The most brushes this viewer holds: the Settings cap narrowing the concession. */
  holdLimit: number;
  queueDepthMs: number;
  /** Strata of the open work (`top + 1`): levels 0 … top − 1 arrive as brushes, the top one as the seed. */
  strata: number;
  eviction: EvictionFigures;
  /** Upper bound of the synthesis workers' parent-plane caches. */
  workerCacheBound: number;
}

export interface TelemetryInput {
  now: number;
  transport: string | null;
  link: RateMeter | null;
  image: ImageTelemetry | null;
  sink: HeldBrushes | null;
  concession: Concession | null;
  /** Bytes of GPU texture storage the viewer holds (shared/lib/gpu-meter). */
  gpuBytes?: number;
  /** The browser's own tab measurement: `undefined` when it cannot measure, `null` before the first result. */
  tabMemory?: TabMemory | null;
  /** The `mem_mib` this viewer declared in SALUDO. */
  declaredMemMiB?: number;
}

/** Stands for a value not known yet: rows keep their place so only values change as data arrives. */
export const PENDING = '—';

export const pending = (keys: readonly string[]): TelemetryRow[] => keys.map((k) => ({ k, v: PENDING }));
