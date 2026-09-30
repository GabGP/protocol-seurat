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
/** A brush the server sends again within this long of Horizon evicting it counts as a refetch (telemetry only). */
export const REFETCH_WINDOW_MS = 60_000;
/** Refetch delays kept for the median (the newest ones). */
export const REFETCH_SAMPLES = 256;

/**
 * Settings "Max brushes": how many brushes this viewer holds, narrowing what the server granted. Each cap is the smallest
 * root-2 step that keeps the on-screen core + sketch at the worst zoom and the average full cone for that viewport (CSS px).
 */
export const BRUSH_CAP_OPTIONS: ReadonlyArray<{ label: string; cap: number }> = [
  { label: '720p', cap: 181 },
  { label: '1080p', cap: 362 },
  { label: '1440p', cap: 512 },
  { label: '4K', cap: 1024 },
];
export const BRUSH_CAP_DEFAULT = 362;
/** localStorage key of the chosen cap. */
export const BRUSH_CAP_KEY = 'seurat.brushCap';
/**
 * The default cap is "auto": round(K x brushes per screen) between MIN and MAX, where brushes per screen is the tiles the
 * backing store covers (a tile of slack per side). K leaves room for the core, the sketch, the rings and a pan margin.
 */
export const BRUSH_CAP_AUTO_K = 5.5;
export const BRUSH_CAP_AUTO_MIN = 160;
export const BRUSH_CAP_AUTO_MAX = 448;
/** Whatever the bounds say, auto holds at least this many screens of tiles: the core at the focus plus the first ring. */
export const BRUSH_CAP_AUTO_FLOOR_K = 2;
/** The Settings value of "Auto" (no stored cap). */
export const BRUSH_CAP_AUTO = 0;
