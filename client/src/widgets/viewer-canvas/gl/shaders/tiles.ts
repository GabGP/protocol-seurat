import { DOT_TILE_CELLS } from '@/shared/config/render';
import { CSS_POS, HEAD, TO_CLIP, cover } from './common';

const DOT_TILE = DOT_TILE_CELLS.toFixed(1);

/** Instanced brush quads: device rect, uv rect, origin-relative image rect, layer. */
export const TILE_VS = `${HEAD}
layout(location = 0) in vec4 aDev;
layout(location = 1) in vec4 aUv;
layout(location = 2) in vec4 aImg;
layout(location = 3) in float aLayer;
uniform vec2 uView;
out vec2 vUv;
out vec2 vImg;
flat out float vLayer;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 dev = mix(aDev.xy, aDev.zw, c);
  vUv = mix(aUv.xy, aUv.zw, c);
  vImg = mix(aImg.xy, aImg.zw, c);
  vLayer = aLayer;
  ${TO_CLIP}
}
`;

/**
 * Brush colour, then (dots on) the pointillist mask: the cell grid is n×n per image pixel,
 * locked to image coordinates; each cell's dot comes from the same tile as the Canvas2D path.
 * Gaps fade to uUnder by uDots (0 = plain image), exactly the Canvas2D hole-pattern maths.
 * uClip (x, y, r > 0) discards outside a CSS-px circle (the loupe).
 */
export const TILE_FS = `${HEAD}${CSS_POS}
precision highp sampler2DArray;
uniform sampler2DArray uTiles;
uniform sampler2D uSketch;
uniform bool uIsSketch;
uniform highp sampler2D uDotTile;
uniform float uDots;
uniform float uDotsPerPx;
uniform vec2 uCellOffset;
uniform float uCellDev;
uniform vec3 uUnder;
uniform vec3 uClip;
in vec2 vUv;
in vec2 vImg;
flat in float vLayer;
out vec4 o;
void main() {
  if (uClip.z > 0.0 && length(cssPos() - uClip.xy) > uClip.z) discard;
  vec3 c = uIsSketch ? texture(uSketch, vUv).rgb : texture(uTiles, vec3(vUv, vLayer)).rgb;
  if (uDots > 0.0) {
    vec2 cellF = vImg * uDotsPerPx;
    vec2 cell = floor(cellF);
    vec4 d = texelFetch(uDotTile, ivec2(mod(cell + uCellOffset, ${DOT_TILE})), 0);
    float cov = ${cover('d.z - length(cellF - cell - d.xy)', 'uCellDev')};
    float gap = uDots * (1.0 - cov);
    c = c * (1.0 - gap) + uUnder * gap;
  }
  o = vec4(c, 1.0);
}
`;
