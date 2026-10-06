export const POINTILLIST_ZOOM_THRESHOLD_PCT = 1200;
export const VIEWER_MAX_ZOOM = 64;
/** A fit above this multiple of 100% raises the zoom ceiling so 1:1 stays reachable on big images. */
export const VIEWER_FIT_ZOOM_HEADROOM = 4;
export const POINTILLIST_AUTO_ZOOM = 16;
export const ZOOM_STEP_FACTOR = 1.6;
export const PRESET_MATCH_TOLERANCE = 0.3;
export const ZOOM_PRESET_TIERS: readonly (number | null)[] = [
  null, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 25600,
];

export const DEFAULT_WORK_WIDTH = 3600;
export const DEFAULT_WORK_HEIGHT = 2400;
/** The CSS viewport assumed where there is no window (first MIRADA of a headless render). */
export const DEFAULT_VIEWPORT_WIDTH = 1920;
export const DEFAULT_VIEWPORT_HEIGHT = 1080;

export const MIN_ZOOM_FIT_RATIO = 0.5;
export const DBLCLICK_ZOOM_IN = 2.5;
export const DBLCLICK_ZOOM_OUT = 0.5;
export const KEY_PAN_STEP_PX = 180;

export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 400;
export const PINCH_SCALE_FACTOR = 0.01;
export const WHEEL_SCALE_FACTOR = 0.0022;

export const ZOOM_EPSILON = 1e-4;
export const ZOOM_LERP_FACTOR = 0.2;
export const PAN_EPSILON = 0.05;
export const PAN_LERP_FACTOR = 0.2;

export const FLING_TRAVEL_MS = 170;
export const VELOCITY_EMA_ALPHA = 0.8;
export const VELOCITY_EMA_BETA = 0.2;
export const FLING_WINDOW_MS = 60;
