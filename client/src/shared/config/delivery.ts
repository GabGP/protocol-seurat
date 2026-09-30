/** RECIBO.libre keeps about this much link time of unconfirmed deliveries in flight. */
export const CREDIT_WINDOW_S = 1;
/** Never advertise fewer: one delivery arriving while the next is confirmed keeps the link busy. */
export const CREDIT_MIN = 2;
/** Bounded number of pending MIRADA seqs remembered for RTT measurement. */
export const RTT_PENDING_MAX = 32;
/** Window over which the minimum RTT sample is tracked (ms). */
export const CREDIT_RTT_WINDOW_MS = 30_000;
/** Ceiling on the RTT addition to the receiver window (seconds). */
export const CREDIT_RTT_MAX_S = 4;
/** Spec 2.3: max_kib = 48 × max_pinceladas, the per-brush share before any delivery is measured. */
export const KIB_PER_BRUSH = 48;
export const RELEASE_BATCH_MS = 100;
export const QUEUE_AMBER_MS = 150;
export const QUEUE_RED_MS = 400;
/** Synthesis pool: keep one core free for main thread + compositor, cap for VRAM/link. */
export const SYNTH_POOL_MIN = 2;
export const SYNTH_POOL_MAX = 8;
export const SYNTH_POOL_FALLBACK_CORES = 4;
/** cola_ms from which the server caps or stops plans (ConePlanner: 150 / 400). */
export const COLA_BUSY_MS = 150;
/** Early (future-epoch) deliveries held at most: max_en_vuelo. */
export const MAX_EARLY_DELIVERIES = 12;
/** Moving average of the delivery size: the previous value keeps this weight, the new one the other. */
export const AVG_DELIVERY_KEEP = 0.8;
export const AVG_DELIVERY_NEW = 0.2;
/** Sketch and pyramid shape assumed until the OBRA of the work says otherwise. */
export const DEFAULT_SEED_WIDTH = 192;
export const DEFAULT_SEED_HEIGHT = 160;
export const DEFAULT_STRATA = 11;
