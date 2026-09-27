export const TAU = Math.PI * 2;

export const BG_COLOR = '#0D0E13';
export const BG_GRID_COLOR = 'rgba(197,198,208,0.13)';
export const BG_GRID_SPACING = 26;
export const BG_GRID_DOT_RADIUS = 1.2;
/** Grid scrolls at this fraction of the pan (parallax). */
export const BG_GRID_PARALLAX = 0.4;

export const IMAGE_SMOOTHING_THRESHOLD = 2;
export const DOT_FADE_RAMP_FACTOR = 0.75;
export const MAX_BACKGROUND_DIM = 0.9;

export const FRAME_SHADOW_PADDING = 40;
export const FRAME_SHADOW_BLUR = 48;
export const FRAME_SHADOW_OFFSET_Y = 12;
export const FRAME_SHADOW_MARGIN = 60;
export const FRAME_SHADOW_COLOR = 'rgba(0,0,0,0.55)';
/** Canvas shadowBlur is 2σ; a Gaussian is invisible past 3σ, so sprites reach 1.5 × blur. */
export const SHADOW_REACH_PER_BLUR = 1.5;

export const LOUPE_RADIUS = 104;
export const LOUPE_SHADOW_BLUR = 28;
export const LOUPE_SHADOW_COLOR = 'rgba(0,0,0,0.6)';
export const LOUPE_MAGNIFICATION = 4;
export const LOUPE_PIXEL_OUTLINE_ZOOM = 6;
export const LOUPE_PIXEL_OUTLINE_WIDTH = 2;
export const LOUPE_RIM_WIDTH = 5;
export const LOUPE_BADGE_OFFSET_Y = 10;
export const LOUPE_BADGE_HEIGHT = 24;
export const LOUPE_BADGE_RADIUS = 12;

export const LOADER_DOT_COUNT = 10;
export const LOADER_SPEED = 1.6;
export const LOADER_ORBIT_RADIUS = 24;
export const LOADER_ORBIT_PULSE = 4;
export const LOADER_DOT_BASE_RADIUS = 2.5;

/** Pointillist view: dots stay ~this many CSS px apart; each image pixel is split into n×n of them. */
export const DOT_SPACING_PX = 6;
/** Dots per side of the repeating jittered tile (big enough that the repeat is not visible). */
export const DOT_TILE_CELLS = 32;

export const HERO_GRID_CELL = 11;
