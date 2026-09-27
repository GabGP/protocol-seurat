export const PROTO_VERSION = 1;
export const WS_SUBPROTOCOL = 'seurat.1';
export const SESSION_PATH = '/seurat/v1/sesion';
export const MAX_FRAME_BYTES = 64 * 1024;
export const WT_READY_TIMEOUT_MS = 3000;
export const GAZE_PER_S = 20;
export const GAZE_BURST = 40;
export const GAZE_QUIET_IDLE_MS = 300;
export const RECEIPT_EVERY_MS = 100;
export const RECEIPT_EVERY_N = 8;
/** RECIBO.libre keeps about this much link time of unconfirmed deliveries in flight. */
export const CREDIT_WINDOW_S = 1;
/** Never advertise fewer: one delivery arriving while the next is confirmed keeps the link busy. */
export const CREDIT_MIN = 2;
export const RELEASE_BATCH_MS = 100;
export const SCRAPE_TIMEOUT_MS = 10_000;
export const LEASE_S = 120;
export const HEARTBEAT_S = 15;
export const DEFAULT_MEM_MIB = 128;
export const CHROME_MEM_MIB = 256;
export const SKETCH_MIN = 7;
export const SKETCH_DELIVERIES = 44;
export const TILE = 256;
export const SEED_STRATUM = 10;
export const BAND_COUNTS = [2048, 4096, 8192, 16384] as const;
export const QUEUE_AMBER_MS = 150;
export const QUEUE_RED_MS = 400;
export const MAX_DATAGRAM_BYTES = 1200;
export const TOKEN_BYTES = 32;
export const TICKET_BYTES = 32;
export const MAX_RETIRED_HANDLES = 16;
/** Synthesis pool: keep one core free for main thread + compositor, cap for VRAM/link. */
export const SYNTH_POOL_MIN = 2;
export const SYNTH_POOL_MAX = 8;
export const SYNTH_POOL_FALLBACK_CORES = 4;
