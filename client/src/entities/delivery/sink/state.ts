import { BAND_COUNTS } from '@/shared/config/constants';
import { AttentionHeat } from '../attention-heat';
import { brushCap } from '../brush-cap';
import { DecodeQueue } from '../decode-queue';
import { Departures } from '../departures';
import type { EvictView } from '../evict-candidate';
import { EvictionStats } from '../eviction-stats';
import { GazeMotion } from '../gaze-motion';
import { PaintedCones } from '../painted-cones';
import { Settlement } from '../settlement';
import { emptyLedger, type DeliveryLedger } from '../store';
import { SynthQueue } from '../synth-queue';
import type { WorkerFactory, WorkerPool } from '../worker-pool';
import type { SynthRequest } from '@/workers/protocol';
import type { DeliveryPort, Grant, PendingScrape } from './port';

/** A delivery waiting for its parent's planes before it can be synthesized. */
export interface PendingSynth {
  req: SynthRequest;
  parentId: bigint;
  edition: number;
  /** The worker already missed this parent: send the bytes, never a reference again. */
  bytes?: boolean;
}

/** Sent to a worker and unanswered: kept for the byte retry after a cache miss. */
export interface InflightSynth {
  req: SynthRequest;
  brushId: bigint;
  epoch: number;
}

/** Calls the lower modules make upward, wired once by the facade (keeps the modules acyclic). */
export interface SinkHooks {
  /** A synthesis failed for good: drop the delivery and tell the server. */
  fail(delivery: number): void;
  /** A worker answered. */
  result(index: number, ev: MessageEvent): void;
}

export interface SinkLimits {
  maxKiB(): number;
  maxBrushes(): number;
}

/** Brushes this viewer holds at most: the user's cap, narrowing the concession (RECIBO.libre and Horizon use it). */
export function holdLimit(s: SinkState): number {
  return Math.min(s.limits.maxBrushes(), brushCap());
}

/** Everything the sink knows, in one place; the service modules read and change it. */
export class SinkState {
  private static nextRevision = 1;
  book: DeliveryLedger = emptyLedger();
  renewThrough = 0;
  /** Bumped on every book mutation; paint caches key on it, not just paintTick. */
  revision = SinkState.nextRevision++;
  pool: WorkerPool | null = null;
  readonly ready = new SynthQueue();
  readonly decode = new DecodeQueue();
  readonly settlement = new Settlement();
  /** This view and the past ones the server may still be painting: never evicted from. */
  readonly cones = new PaintedCones();
  /** Why brushes left the book, for the refusal log. */
  readonly departures = new Departures();
  /** Local telemetry: what Horizon evicted and what came back. */
  readonly evictions = new EvictionStats();
  readonly gaze = new GazeMotion();
  readonly heat = new AttentionHeat();
  receiptTimer = 0;
  releaseTimer = 0;
  expiredQueue: number[] = [];
  /** The earliest lease end in the book (renewals only push it later): no sweep is due before it. */
  nextExpiry = Infinity;
  scrapes: PendingScrape[] = [];
  lastScrape: { through: number; epoch: number } | null = null;
  cancelled = new Set<number>();
  grant: Grant | null = null;
  /** A RASPAR TODO arrived: the work is being withdrawn. */
  withdrawn = false;
  /** Deliveries of an epoch whose CONCESION has not arrived yet (flows can overtake control). */
  early: Array<() => void> = [];
  avgDelivery = 0;
  /** The largest delivery held so far (band bytes): what the byte window reserves per brush. */
  largest = 0;
  linkBps = 0;
  pending = new Map<number, PendingSynth>();
  failed = new Set<number>();
  /** Deliveries whose planes are being rebuilt from their bands (planes-only synthesis): one request each. */
  rebuilding = new Set<number>();
  /** Released bitmaps asked for again (waiting for a window slot) and those being rebuilt: see `restore-queue`. */
  wanted = new Set<number>();
  restoring = new Set<number>();
  /** Deliveries a pixel readout asked planes for, oldest first (bounded by `PLANES_READOUT_KEEP`): they are held for it. */
  readout: number[] = [];
  nextSynthesisId = 1;
  activeSynthesis = new Map<number, number>();
  /** brushKey -> worker index holding its planes (ref routing + stickiness). */
  origin = new Map<string, number>();
  inflight = new Map<number, InflightSynth>();
  repaint = (): void => undefined;
  view: EvictView | null = null;
  /** The work's size in image px (ABIERTA); until known, the seed scaled to full size bounds it. */
  extent: { w: number; h: number } | null = null;
  /** Bands the plan wants at the view's focus stratum (`focusBands`); coarser core wants all. */
  focusBands: number = BAND_COUNTS.length;
  /** When `view` went on screen (s), so its brushes get the dwell as attention heat. */
  viewSince = 0;
  lastFree = -1;
  lastQueue = 0;
  lastRenew = 0;
  hooks: SinkHooks = { fail: () => undefined, result: () => undefined };

  constructor(
    readonly handle: number,
    readonly port: () => DeliveryPort | null,
    readonly limits: SinkLimits,
    readonly seedWidth: number,
    readonly seedHeight: number,
    readonly strata: number,
    readonly poolSize: number,
    readonly createWorker: WorkerFactory,
  ) {}

  get top(): number {
    return Math.max(0, this.strata - 1);
  }

  get size(): { w: number; h: number } {
    return this.extent ?? { w: this.seedWidth * 2 ** this.top, h: this.seedHeight * 2 ** this.top };
  }
}
