/**
 * GLSL ES 3.00 chunks shared by the WebGL2 viewer's shaders. Coordinates: `uView` is the drawing
 * buffer in device px, CSS px = device px / `uDpr`, origin top-left (gl_FragCoord is flipped once, here).
 */

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

export const CSS_POS = `
uniform vec2 uView;
uniform float uDpr;
vec2 cssPos() { return vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y) / uDpr; }
`;

export const ERF = `
float erf1(float x) {
  float s = sign(x), a = abs(x);
  float t = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
  t *= t;
  return s - s / (t * t);
}
`;

/** 1 / sqrt(2): scales a distance in σ units to the argument of erf. */
export const INV_SQRT2 = '0.70710678';

/** Device px `dev` to clip space (a vertex shader statement). */
export const TO_CLIP = 'gl_Position = vec4(dev.x / uView.x * 2.0 - 1.0, 1.0 - dev.y / uView.y * 2.0, 0.0, 1.0);';

/** Anti-aliased coverage of a signed distance `dist` (CSS px): one device px wide ramp by default. */
export function cover(dist: string, scale = 'uDpr'): string {
  return `clamp((${dist}) * ${scale} + 0.5, 0.0, 1.0)`;
}
