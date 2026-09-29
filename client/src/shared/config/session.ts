export const WT_READY_TIMEOUT_MS = 3000;
export const GAZE_PER_S = 20;
export const GAZE_BURST = 40;
export const GAZE_QUIET_IDLE_MS = 300;
export const RECEIPT_EVERY_MS = 100;
export const RECEIPT_EVERY_N = 8;
export const LEASE_S = 120;
/** Reconnect after a lost connection (spec 8: POST /sesion + REANUDAR), backing off up to the max. */
export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 8000;
export const HEARTBEAT_S = 15;
export const DEFAULT_MEM_MIB = 128;
export const CHROME_MEM_MIB = 256;
export const MAX_RETIRED_HANDLES = 16;
/** Spec 6.1 max_en_vuelo: flows the server may have open for a session at once. */
export const WIRE_FLOWS = 12;
export const SCRAPE_TIMEOUT_MS = 10_000;
/** The session-wide brush cap a client assumes before BIENVENIDA states it. */
export const SESSION_MAX_BRUSHES = 1024;
/** MiB declared per GiB of device memory (a quarter of it), capped at CHROME_MEM_MIB. */
export const MEM_MIB_PER_DEVICE_GIB = 64;
