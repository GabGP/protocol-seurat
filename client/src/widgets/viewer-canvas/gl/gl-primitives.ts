import {
  BG_GRID_DOT_RADIUS, BG_GRID_PARALLAX, BG_GRID_SPACING, FRAME_SHADOW_SIGMA,
} from '@/shared/config/render';
import { GL_BG, GL_GRID_DOT, GL_SHADOW_ALPHA } from './gl-colors';
import type { GLResources } from './gl-resources';

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

/** Screen-space shapes in CSS px: the background, the frame shadow, solid fills, discs and outlines. */
export class GLPrimitives {
  constructor(private readonly r: GLResources) {}

  background(tx: number, ty: number, grid: boolean): void {
    const { gl, W, H } = this.r;
    const g = BG_GRID_SPACING;
    const dot = GL_GRID_DOT;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.r.empty);
    this.r.frame(this.r.bg)
      .f4('uRect', 0, 0, W, H).f3('uBg', GL_BG).f4('uDot', dot[0], dot[1], dot[2], dot[3])
      .f2('uOffset', (((tx * BG_GRID_PARALLAX) % g) + g) % g, (((ty * BG_GRID_PARALLAX) % g) + g) % g)
      .f1('uSpacing', g).f1('uRadius', BG_GRID_DOT_RADIUS).i1('uGrid', grid ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  frameShadow(x0: number, y0: number, x1: number, y1: number): void {
    const gl = this.r.gl;
    const reach = 3 * FRAME_SHADOW_SIGMA;
    this.blendOn();
    this.r.frame(this.r.shadow)
      .f4('uRect', x0 - reach, y0 - reach, x1 + reach, y1 + reach).f4('uBox', x0, y0, x1, y1)
      .f1('uSigma', FRAME_SHADOW_SIGMA).f1('uAlpha', GL_SHADOW_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** Solid CSS rect via a scissored clear (no program needed). */
  fill(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const { gl, canvas, dpr: d } = this.r;
    const X0 = Math.max(0, Math.round(x0 * d));
    const X1 = Math.min(canvas.width, Math.round(x1 * d));
    const Y0 = Math.max(0, Math.round(y0 * d));
    const Y1 = Math.min(canvas.height, Math.round(y1 * d));
    if (X1 <= X0 || Y1 <= Y0) return;
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(X0, canvas.height - Y1, X1 - X0, Y1 - Y0);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  discShape(cx: number, cy: number, radius: number, ring: number, sigma: number, color: Rgba): void {
    const gl = this.r.gl;
    const e = radius + ring + 3 * sigma + 1;
    this.blendOn();
    this.r.frame(this.r.disc)
      .f4('uRect', cx - e, cy - e, cx + e, cy + e).f2('uCenter', cx, cy).f1('uRadius', radius)
      .f1('uRing', ring).f1('uSigma', sigma).f4('uColor', color[0], color[1], color[2], color[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  outlineBox(x0: number, y0: number, x1: number, y1: number, width: number, clip: Rgb): void {
    const gl = this.r.gl;
    const e = width;
    this.blendOn();
    this.r.frame(this.r.outline)
      .f4('uRect', x0 - e, y0 - e, x1 + e, y1 + e).f4('uBox', x0, y0, x1, y1).f1('uWidth', width)
      .f4('uColor', 1, 1, 1, 1).f3('uClip', clip);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  /** Straight-alpha blending over the empty vertex array (the quad comes from gl_VertexID). */
  private blendOn(): void {
    const gl = this.r.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.r.empty);
  }
}
