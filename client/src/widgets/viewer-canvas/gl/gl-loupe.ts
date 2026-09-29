import {
  LOUPE_PIXEL_OUTLINE_WIDTH, LOUPE_PIXEL_OUTLINE_ZOOM, LOUPE_RADIUS, LOUPE_RIM_WIDTH, LOUPE_SHADOW_BLUR,
} from '@/shared/config/render';
import { clamp } from '@/shared/lib/clamp';
import { BrushCuller, type BrushGeom } from '@/entities/delivery';
import { GL_BG, GL_LOUPE_SHADOW, GL_RIM } from './gl-colors';
import { clipView } from './gl-instances';
import type { GLPrimitives } from './gl-primitives';
import type { GLResources } from './gl-resources';
import { dotsAt, type GLTilePass } from './gl-tile-pass';
import type { FrameState } from '../model/view-renderer';

/** The magnifier: a shadowed disc holding the image at `L`, clipped to it, with pixel box and rim. */
export class GLLoupe {
  private readonly culler = new BrushCuller();

  constructor(
    private readonly r: GLResources,
    private readonly prims: GLPrimitives,
    private readonly pass: GLTilePass,
  ) {}

  /** Draws the loupe over the finished frame; returns draws issued. */
  draw(f: FrameState, ready: BrushGeom[], { mx, my, L }: { mx: number; my: number; L: number }): number {
    const R = LOUPE_RADIUS;
    const ix = clamp((mx - f.tx) / f.s, 0, f.iw);
    const iy = clamp((my - f.ty) / f.s, 0, f.ih);
    const ltx = mx - ix * L;
    const lty = my - iy * L;
    const clip = [mx, my, R] as const;
    this.prims.discShape(mx, my, R, 0, LOUPE_SHADOW_BLUR / 2, GL_LOUPE_SHADOW);
    this.prims.discShape(mx, my, R, 0, 0, [GL_BG[0], GL_BG[1], GL_BG[2], 1]);
    let drawn = 0;
    const v = clipView(ltx, lty, L, f.iw, f.ih, mx - R, my - R, mx + R, my + R, this.r.dpr);
    if (v) {
      const list = this.culler.cull(ready, L * this.r.dpr, f.iw, f.ih, f.flags.cull, f.flags.lod);
      drawn = this.pass.draw(list, v, L, { dots: dotsAt(f, L), clip });
    }
    if (L >= LOUPE_PIXEL_OUTLINE_ZOOM) {
      const x0 = ltx + Math.floor(ix) * L;
      const y0 = lty + Math.floor(iy) * L;
      this.prims.outlineBox(x0, y0, x0 + L, y0 + L, LOUPE_PIXEL_OUTLINE_WIDTH, clip);
    }
    this.prims.discShape(mx, my, R, LOUPE_RIM_WIDTH, 0, [GL_RIM[0], GL_RIM[1], GL_RIM[2], 1]);
    return drawn;
  }
}
