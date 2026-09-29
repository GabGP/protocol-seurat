import { CSS_POS, ERF, HEAD, INV_SQRT2, TO_CLIP, cover } from './common';

/** A quad from gl_VertexID (triangle strip 0..3) over a CSS rect `uRect` (x0, y0, x1, y1). */
export const RECT_VS = `${HEAD}
uniform vec2 uView;
uniform float uDpr;
uniform vec4 uRect;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 dev = mix(uRect.xy, uRect.zw, c) * uDpr;
  ${TO_CLIP}
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
    float cov = ${cover('uRadius - length(q)')};
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
  vec4 q = vec4(p - uBox.xy, p - uBox.zw) * (${INV_SQRT2} / uSigma);
  vec4 e = 0.5 + 0.5 * vec4(erf1(q.x), erf1(q.y), erf1(q.z), erf1(q.w));
  o = vec4(0.0, 0.0, 0.0, uAlpha * (e.x - e.z) * (e.y - e.w));
}
`;
