export const FIT_BREAKPOINT_MOBILE = 700;
export const FIT_PAD_MOBILE = 16;
export const FIT_PAD_DESKTOP = 72;
export const FIT_TOP_CLEARANCE = 88;
export const FIT_BOTTOM_CLEARANCE = 168;
export const FIT_TOP_CLEARANCE_MOBILE = 56;
export const FIT_BOTTOM_CLEARANCE_MOBILE = 80;

export const MINIMAP_MAX_W = 180;
export const MINIMAP_MAX_H = 140;
/** Thumbnail rebuilds at most this often while paint streams in (the viewport box is per frame). */
export const MINIMAP_THUMB_MS = 250;

export const SLIDER_WIDTH = 168;
export const SLIDER_HEIGHT = 48;

export const GALLERY_COLUMNS_WIDTH = 300;
export const GALLERY_MAX_WIDTH = 1440;
/** Density a thumbnail is fetched at: past 2× a card looks no sharper, but costs 2.25× the pixels at 3×. */
export const PREVIEW_DPR_MAX = 2;
/** Long and minimum side of a gallery card's noise placeholder (the seed itself draws at card size). */
export const GALLERY_PLACEHOLDER_PX = 144;
export const GALLERY_PLACEHOLDER_MIN_PX = 32;
