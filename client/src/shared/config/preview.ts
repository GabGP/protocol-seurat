/** RECIBO.libre of a gallery preview: the server's opening window, enough for a card's cone. */
export const PREVIEW_CREDIT = 8;
/** A visible gallery repeats its previews' MIRADA well inside the server's 60 s inactivity floor (spec 2.3). */
export const PREVIEW_GAZE_KEEPALIVE_MS = 30_000;
/** Gallery previews: works opened at once, and how long one may take to bring its seed. */
export const PREVIEW_OPENS = 3;
export const PREVIEW_OPEN_TIMEOUT_MS = 5000;
/** Decode workers for previews (never more than the synthesis pool), and a decode's deadline before its worker is replaced. */
export const PREVIEW_DECODERS_MAX = 4;
export const PREVIEW_DECODE_TIMEOUT_MS = 10_000;
/** A preview's decoded levels are kept this long after its last compose, for the next piece to build on. */
export const PREVIEW_LEVELS_KEEP_MS = 2000;
/** A card whose pieces kept coming while it was composed waits this long before the next compose, so a burst is one. */
export const PREVIEW_RECOMPOSE_GAP_MS = 150;
