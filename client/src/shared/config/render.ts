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
/** The badge flips above the loupe when it would end within this many px of the canvas bottom. */
export const LOUPE_BADGE_FLIP_PX = 40;

export const LOADER_DOT_COUNT = 10;
export const LOADER_SPEED = 1.6;
export const LOADER_ORBIT_RADIUS = 24;
export const LOADER_ORBIT_PULSE = 4;
export const LOADER_DOT_BASE_RADIUS = 2.5;
/** Angular speed of the orbit pulse and of the dot-size pulse (rad/s), and the per-dot size phase step. */
export const LOADER_ORBIT_PULSE_SPEED = 3;
export const LOADER_SIZE_PULSE_SPEED = 4;
export const LOADER_SIZE_PHASE_STEP = 0.7;
/** The loader dots cycle through these colours. */
export const LOADER_COLORS: readonly string[] = ['#B8C4FF', '#FF8A5B', '#DDE1F9', '#FFB599'];

/** Brand accent: the loupe rim and the minimap viewport box. */
export const ACCENT_COLOR = '#B8C4FF';
export const FRAME_FILL_COLOR = '#000';
/** The opaque fill a shadow-only sprite draws with; only its shadow survives (the shape is shifted off-canvas). */
export const SHADOW_MASK_COLOR = '#000';
export const PIXEL_OUTLINE_COLOR = '#FFFFFF';

export const MINIMAP_BG_COLOR = '#23242B';
export const MINIMAP_DOT_COLOR = 'rgba(197,198,208,0.25)';
export const MINIMAP_DOT_STEP = 8;
export const MINIMAP_DOT_SIZE = 1.5;
export const MINIMAP_SHADE_COLOR = 'rgba(13,14,19,0.6)';
export const MINIMAP_BOX_WIDTH = 2;
export const MINIMAP_BOX_RADIUS = 3;
export const MINIMAP_MIN_BOX = 4;
/** The viewport box counts as the whole image within this many minimap px. */
export const MINIMAP_FULL_TOLERANCE = 0.5;

/** Pointillist dot radius is DOT_RADIUS_MIN + DOT_RADIUS_SPAN × hash, in cell units; jitter uses DOT_JITTER_ROOM of the free room. */
export const DOT_RADIUS_MIN = 0.3;
export const DOT_RADIUS_SPAN = 0.1;
export const DOT_JITTER_ROOM = 0.8;

/** Pointillist view: dots stay ~this many CSS px apart; each image pixel is split into n×n of them. */
export const DOT_SPACING_PX = 6;
/** Dots per side of the repeating jittered tile (big enough that the repeat is not visible). */
export const DOT_TILE_CELLS = 32;

export const HERO_GRID_CELL = 11;
/** Gallery hero dots: each grows in over HERO_GROW_S with a back-ease (overshoot HERO_EASE_OVERSHOOT). */
export const HERO_GROW_S = 0.55;
export const HERO_EASE_OVERSHOOT = 1.70158;
/** Growth starts at (1 - x/cols) × HERO_WAVE_S + hash × HERO_WAVE_JITTER_S: a wave from the right edge. */
export const HERO_WAVE_S = 0.7;
export const HERO_WAVE_JITTER_S = 0.45;
/** Dot jitter (cells) and radius (cells) = HERO_DOT_R_MIN + HERO_DOT_R_SPAN × hash. */
export const HERO_JITTER = 0.35;
export const HERO_DOT_R_MIN = 0.26;
export const HERO_DOT_R_SPAN = 0.2;

/** WebGL2 renderer (spec §5.1): tile texture arrays of this many 256² layers (16 MiB each; one with no brush left is deleted). */
export const GL_ATLAS_LAYERS = 64;
/** Tile uploads stop for the frame once they have taken this long (at least one always goes). */
export const GL_UPLOAD_BUDGET_MS = 3;
/** A lost WebGL context not restored within this long is given up on: Canvas2D takes over. */
export const GL_RESTORE_WAIT_MS = 3000;
/** Frame shadow: canvas shadowBlur is 2σ. */
export const FRAME_SHADOW_SIGMA = FRAME_SHADOW_BLUR / 2;
