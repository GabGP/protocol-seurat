export const PROTO_VERSION = 1;
export const WS_SUBPROTOCOL = 'seurat.1';
export const SESSION_PATH = '/seurat/v1/sesion';
/** PUT /seurat/v1/obras/{name} streams a master or .zip into the server inbox (spec 3.1). */
export const OBRAS_PATH = '/seurat/v1/obras/';
/** POST /seurat/v1/importar: the server fetches a link, or links a path on its own disk (localhost only). */
export const IMPORT_PATH = '/seurat/v1/importar';
/** `cliente` in POST /sesion (spec 3.4.1). */
export const CLIENT_NAME = 'visor/2.0';
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_DATAGRAM_BYTES = 1200;
export const TOKEN_BYTES = 32;
export const TICKET_BYTES = 32;
export const TILE = 256;
/** A parent plane is the half-resolution tile: HALF samples a side, HALF_CELLS in all. */
export const TILE_HALF = TILE / 2;
export const TILE_HALF_CELLS = TILE_HALF * TILE_HALF;
export const SEED_STRATUM = 10;
export const BAND_COUNTS = [2048, 4096, 8192, 16384] as const;
export const SKETCH_MIN = 7;
export const SKETCH_DELIVERIES = 44;
/** A type below this is mandatory: unknown is fatal ERROR 1; at or above it is skipped (spec 3.2). */
export const MANDATORY_TYPE_LIMIT = 0x40;
/** REGULACION peldaño of an unregulated session: the normal cone (ADR-07). */
export const RUNG_NORMAL = 3;
/** SOLTAR motivo (spec 3.3). 1 is DESALOJO (ADR-10): a voluntary release, ordered by Horizon when it relieves memory. */
export const ReleaseReason = {
  EVICTED: 1, DECODE_FAILED: 2, EXPIRED: 3, BUDGET: 4, CRC: 6, REPLACED: 7,
} as const;
/** RASPAR predicado (spec 3.3). */
export const ScrapePredicate = { LOW_STRATUM: 1, OUTSIDE: 2, BANDS: 3, LIST: 4, ALL: 5 } as const;
/** ERROR codes the client reads or sends (spec 3.5). */
export const ErrorCode = { PROTOCOL: 1, NO_SUCH_WORK: 4, RESUME_REJECTED: 12 } as const;
/** TLV tags (spec 3.5, ADR-06): SALUDO 0x01 REANUDAR, BIENVENIDA 0x02 FICHA and 0x03 REANUDADAS, PLAN 0x04 IRRECUPERABLES. */
export const TlvTag = { RESUME: 0x01, TICKET: 0x02, RESUMED: 0x03, UNRECOVERABLE: 0x04 } as const;
