package seurat.config;

/** Central numbers from the spec. No literals elsewhere. */
public final class SeuratConstants {
    private SeuratConstants() {}

    public static final int HTTP_PORT = 8080;
    public static final long LEASE_S = 120;
    /** delta's floor: delta = max(1 s, 2 RTT) (spec 8). */
    public static final long SKEW_MS = 1000;
    public static final long HEARTBEAT_S = 15;
    public static final int MAX_IN_FLIGHT = 12;
    /** Receiver window (unconfirmed deliveries) a canvas gets before its first RECIBO.libre. */
    public static final int INITIAL_CREDIT = 8;
    public static final int GLOBAL_SLOTS = 512;
    public static final long CODEL_TARGET_NS = 25_000_000L;
    public static final long CODEL_TICK_MS = 250;
    public static final int FRAME_MAX = 64 * Units.BYTES_PER_KIB;
    public static final int DATAGRAM_MAX = 1200;
    public static final int TOKEN_BYTES = 32;
    /** mem_mib when the client declares none (spec 5.1: no deviceMemory API). */
    public static final long DEFAULT_MEM_MIB = 128;
    public static final long TOKEN_TTL_S = 120;
    /** Longest HTTP request line or header line accepted before the handshake (bytes). */
    public static final int HTTP_LINE_MAX = 8 * Units.BYTES_PER_KIB;
    /** Most headers accepted on one HTTP request. */
    public static final int HTTP_HEADERS_MAX = 100;
    /** How long a connection may stay silent before its SALUDO arrives (seconds). */
    public static final long HANDSHAKE_S = 10;
    /** Control frames (ping, pong, close) carry at most this many payload bytes (RFC 6455 5.5). */
    public static final int WS_CONTROL_MAX = 125;
    public static final int BRUSH_SIDE = 256;
    public static final long SCRAPE_TIMEOUT_S = 10;
    public static final long RENEW_S = 60;
    public static final long AUDIT_S = 60;
    public static final long AUDIT_EVERY_N = 500;
    public static final long IDLE_S = 60;
    public static final long STALL_S = 30;
    public static final int GAZE_PER_S = 20;
    public static final int GAZE_BURST = 40;
    /** ERROR 9 only for sustained abuse: more than this many MIRADA/s for GAZE_ABUSE_S (spec 6.2). */
    public static final int GAZE_ABUSE_PER_S = 200;
    public static final int GAZE_ABUSE_S = 5;
    /** Coalesced MIRADA are released by this tick as the bucket refills. */
    public static final long GAZE_TICK_MS = 50;
    public static final int RECEIPT_EVERY_MS = 100;
    public static final int RECEIPT_EVERY_N = 8;
    /** Input queue per session, in frames (spec 9.2): a full queue stops reading the socket. */
    public static final int INPUT_QUEUE_FRAMES = 256;
    /** Cap on one plan's entries (the cone is proportional to the focus, never near this). */
    public static final int PLAN_MAX_ENTRIES = 16_384;
    /** Numbers one Rangos may name: more than any book can hold, far below a DoS. */
    public static final int RANGES_MAX_NUMBERS = 1 << 20;
    /** cola_ms thresholds (spec 6.1): amber halves max_en_vuelo, red stops new flows until < amber. */
    public static final long QUEUE_AMBER_MS = 150;
    public static final long QUEUE_RED_MS = 400;
    /** Painter re-check period while entries wait on a gate that frees by time (rate, aging). */
    public static final long PAINTER_WAIT_MS = 20;
    /** LATIDO without ECO before the session is declared dead (3 x 15 s = 45 s, spec 8). */
    public static final int HEARTBEAT_MISSES = 3;
    /** Stride weight per role (spec 6.2): 1 by default. */
    public static final double ROLE_WEIGHT = 1.0;
    public static final int SEED_STRATUM = 10;
    public static final int SKETCH_MIN = 7;
    /** Band deflate level: 4 halves level 6's encode time for ~1.5% larger bands (measured on 31 GP). */
    public static final int DEFLATE_LEVEL = 4;
    /** Source rows per ImageIO decode: fewer rescan restarts on JPEG MCU streams. */
    public static final int INGEST_CHUNK_ROWS = 2048;
    /** Cap on one decoded chunk (rows * width * 4 B) for very wide masters. */
    public static final long INGEST_CHUNK_BYTES = 256L * Units.BYTES_PER_MIB;
    /** Row slices per channel when a band is converted or transformed on the ingest fast lane. */
    public static final int INGEST_LANE_SLICES = 8;
    /** JPEG MCU rows the scan decodes before they are painted in parallel. */
    public static final int INGEST_JPEG_ROWS_IN_FLIGHT = 8;
    /** Bands the read-ahead producer may hold while workers encode. */
    public static final int INGEST_READAHEAD_BANDS = 2;
    /** Graceful shutdown: per-executor await before forcing stop. */
    public static final long SHUTDOWN_TIMEOUT_S = 5;
    /** Graceful shutdown: poll interval while draining in-flight paint. */
    public static final long SHUTDOWN_POLL_MS = 50;
    /** Operator alerts AuditLog keeps for dump(); older ones only survive in the console log. */
    public static final int AUDIT_KEEP = 1024;
    /** Brushes whose corrupt band the store remembers (older ones are forgotten and would alert again). */
    public static final int BAD_BANDS_KEEP = 4096;
    /** Progress without a terminal: one INFO line per this many percent (every percent goes to DEBUG). */
    public static final int PROGRESS_STEP_PCT = 10;
    /** Cells in a progress bar, sticky line and step lines alike. */
    public static final int PROGRESS_BAR_CELLS = 10;
    /** Sticky bar width when COLUMNS is unset: a wrapped bar cannot be wiped in place. */
    public static final int PROGRESS_COLUMNS = 80;
    /** A phase shows an ETA only after running this long: earlier extrapolations swing wildly. */
    public static final long PROGRESS_ETA_MIN_MS = 1_000;
    /** A work, file or zip name in a log line is cut to ("...") or padded to this many characters. */
    public static final int LOG_NAME_WIDTH = 32;
}

