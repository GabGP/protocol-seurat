import {
  ACCENT_COLOR, BG_COLOR, BG_GRID_COLOR, FRAME_SHADOW_COLOR, LOADER_COLORS, LOUPE_SHADOW_COLOR,
} from '@/shared/config/render';
import { rgb, rgba } from './gl-context';

/** The renderer's palette, converted once to the 0..1 floats the shaders take. */
export const GL_LOADER_RGB = LOADER_COLORS.map(rgb);
export const GL_BG = rgb(BG_COLOR);
export const GL_GRID_DOT = rgba(BG_GRID_COLOR);
export const GL_SHADOW_ALPHA = rgba(FRAME_SHADOW_COLOR)[3];
export const GL_LOUPE_SHADOW = rgba(LOUPE_SHADOW_COLOR);
export const GL_RIM = rgb(ACCENT_COLOR);
