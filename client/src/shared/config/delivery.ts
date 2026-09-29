/** RECIBO.libre keeps about this much link time of unconfirmed deliveries in flight. */
export const CREDIT_WINDOW_S = 1;
/** Never advertise fewer: one delivery arriving while the next is confirmed keeps the link busy. */
export const CREDIT_MIN = 2;
/** Spec 2.3: max_kib = 48 × max_pinceladas, the per-brush share before any delivery is measured. */
export const KIB_PER_BRUSH = 48;
export const RELEASE_BATCH_MS = 100;
export const QUEUE_AMBER_MS = 150;
export const QUEUE_RED_MS = 400;
/** Synthesis pool: keep one core free for main thread + compositor, cap for VRAM/link. */
export const SYNTH_POOL_MIN = 2;
export const SYNTH_POOL_MAX = 8;
export const SYNTH_POOL_FALLBACK_CORES = 4;
