import { DOT_TILE_CELLS } from '@/shared/config/render';

/**
 * GLSL ES 3.00 sources for the WebGL2 viewer. Coordinates: `uView` is the drawing buffer in device
 * px, CSS px = device px / `uDpr`, origin top-left (gl_FragCoord is flipped once, here).
 */

const DOT_TILE = DOT_TILE_CELLS.toFixed(1);

const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const CSS_POS = `
uniform vec2 uView;
uniform float uDpr;
vec2 cssPos() { return vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) / uDpr; }
`;

const ERF = `
float erf1(float x) {
  float s = sign(x), a = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  t *= t;
  return s - s / (t * t);
}
`;

/** A quad from gl_VertexID (triangle strip 0..3) over a CSS rect `uRect` (x0, y0, x1, y1). */
export const RECT_VS = `${HEAD}
uniform vec2 uView;
uniform float uDpr;
uniform vec4 uRect;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 dev = mix(uRect.xy, uRect.zw, c) * uDpr;
  gl_Position = vec4(dev.x / uView.x * 2.0 - 1.0, 1.0 - dev.y / uView.y * 2.0, 0.0, 1.0);
}
`;

/** Background colour + parallax dot grid (the Canvas2D pattern tile, analytically). */
export const BG_FS = `${HEAD}${CSS_POS}
uniform vec3 uBg;
uniform vec4 uDot;
uniform vec2 uOffset;
uniform float uSpacing;
uniform float uRadius;
uniform bool uGrid;
out vec4 o;
void main() {
  vec3 c = uBg;
  if (uGrid) {
    vec2 q = mod(cssPos() - uOffset + 0.5 * uSpacing, uSpacing) - 0.5 * uSpacing;
    float cov = clamp((uRadius - length(q)) * uDpr + 0.5, 0.0, 1.0);
    c = mix(c, uDot.rgb, uDot.a * cov);
  }
  o = vec4(c, 1.0);
}
`;

/** Gaussian shadow of the box uBox (CSS px), the closed form of canvas shadowBlur (σ = blur / 2). */
export const SHADOW_FS = `${HEAD}${CSS_POS}${ERF}
uniform vec4 uBox;
uniform float uSigma;
uniform float uAlpha;
out vec4 o;
void main() {
  vec2 p = cssPos();
  vec4 q = vec4(p - uBox.xy, p - uBox.zw) * (0.70710678 / uSigma);
  vec4 e = 0.5 + 0.5 * vec4(erf1(q.x), erf1(q.y), erf1(q.z), erf1(q.w));
  o = vec4(0.0, 0.0, 0.0, uAlpha * (e.x - e.z) * (e.y - e.w));
}
`;

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
  gl_Position = vec4(dev.x / uView.x * 2.0 - 1.0, 1.0 - dev.y / uView.y * 2.0, 0.0, 1.0);
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
    float cov = clamp((d.z - length(cellF - cell - d.xy)) * uCellDev + 0.5, 0.0, 1.0);
    float gap = uDots * (1.0 - cov);
    c = c * (1.0 - gap) + uUnder * gap;
  }
  o = vec4(c, 1.0);
}
`;

/** A rect outline of width uWidth centred on uBox's edges (the loupe's pixel box), clipped to uClip. */
export const OUTLINE_FS = `${HEAD}${CSS_POS}
uniform vec4 uBox;
uniform float uWidth;
uniform vec4 uColor;
uniform vec3 uClip;
out vec4 o;
void main() {
  vec2 p = cssPos();
  if (uClip.z > 0.0 && length(p - uClip.xy) > uClip.z) discard;
  vec2 c = 0.5 * (uBox.xy + uBox.zw);
  vec2 h = 0.5 * (uBox.zw - uBox.xy);
  vec2 q = abs(p - c) - h;
  float d = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
  o = vec4(uColor.rgb, uColor.a * clamp((0.5 * uWidth - d) * uDpr + 0.5, 0.0, 1.0));
}
`;

/**
 * One disc (CSS px): filled, a ring of width uRing, or a Gaussian-soft edge of σ = uSigma
 * (the loader dots, the loupe disc, its shadow and rim). Straight alpha, blended.
 */
export const DISC_FS = `${HEAD}${CSS_POS}${ERF}
uniform vec2 uCenter;
uniform float uRadius;
uniform float uRing;
uniform float uSigma;
uniform vec4 uColor;
out vec4 o;
void main() {
  float d = length(cssPos() - uCenter);
  float a;
  if (uSigma > 0.0) a = 0.5 - 0.5 * erf1((d - uRadius) * 0.70710678 / uSigma);
  else if (uRing > 0.0) a = clamp((0.5 * uRing - abs(d - uRadius)) * uDpr + 0.5, 0.0, 1.0);
  else a = clamp((uRadius - d) * uDpr + 0.5, 0.0, 1.0);
  o = vec4(uColor.rgb, uColor.a * a);
}
`;
