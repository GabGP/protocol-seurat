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
/** Reconnect after a lost connection (spec 8: POST /sesion + REANUDAR), backing off up to the max. */
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 8000;
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
/** §5.2.3 voluntary eviction: pressure when owned + in flight ≥ max − HEADROOM or bytes > PRESSURE; relieve down to TARGET. */
export const EVICT_HEADROOM = 8;
export const EVICT_PRESSURE = 0.9;
export const EVICT_TARGET = 0.75;
/** Horizon eviction — gaze α-β filter (x, y in image px; z = log2 image px per screen px). */
export const GAZE_ALPHA = 0.5;
export const GAZE_BETA = 0.2;
/** A gap longer than this between views restarts the filter (velocity unknown). */
export const GAZE_STALE_S = 2;
/** Without new views the estimated velocity halves every this many seconds (the user stopped). */
export const GAZE_VELOCITY_HALF_LIFE_S = 0.5;
/** Reference pan speed, in view half-diagonals per second: scale-invariant "typical exploring". */
export const HORIZON_PAN_REF = 0.5;
/** Reference zoom speed, in pyramid levels per second. */
export const HORIZON_ZOOM_REF = 0.5;
/** Receding never slows the closing speed below this fraction of the reference. */
export const HORIZON_FLOOR = 0.1;
/** Attention heat: dwell seconds decay with this half-life; one view contributes at most CAP seconds. */
export const HEAT_HALF_LIFE_S = 120;
export const HEAT_DWELL_CAP_S = 30;
/** time-to-need is divided by 1 + GAIN × heat (heat in dwell seconds). */
export const HEAT_GAIN = 0.5;
