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
