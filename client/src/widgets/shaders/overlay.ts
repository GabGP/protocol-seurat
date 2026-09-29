import { CSS_POS, ERF, HEAD, INV_SQRT2, cover } from './common';

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
  o = vec4(uColor.rgb, uColor.a * ${cover('0.5 * uWidth - d')});
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
  if (uSigma > 0.0) a = 0.5 - 0.5 * erf1((d - uRadius) * ${INV_SQRT2} / uSigma);
  else if (uRing > 0.0) a = ${cover('0.5 * uRing - abs(d - uRadius)')};
  else a = ${cover('uRadius - d')};
  o = vec4(uColor.rgb, uColor.a * a);
}
`;
