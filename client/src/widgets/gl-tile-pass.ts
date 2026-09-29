import {
  DOT_FADE_RAMP_FACTOR, DOT_TILE_CELLS, IMAGE_SMOOTHING_THRESHOLD, MAX_BACKGROUND_DIM,
} from '@/shared/config/render';
import type { BrushGeom } from './brush-cull';
import { SKETCH_STRATUM } from './brush-cull';
import { GL_BG } from './gl-colors';
import { arrayRuns, INSTANCE_FLOATS, packTiles, type PackView } from './gl-instances';
import type { GLResources } from './gl-resources';
import { dotsPerSide } from './pointillism';
import type { TileAtlas } from './tile-atlas';
import type { FrameState } from './view-renderer';

const FLOAT_BYTES = 4;
const STRIDE = INSTANCE_FLOATS * FLOAT_BYTES;
const INITIAL_INSTANCES = 64;

/** Per-layer extras for the tile pass: the dot mask and the loupe's circular clip. */
export interface LayerOpts {
  dots: number;
  clip: readonly [number, number, number] | null;
}

/** Gap fade of the dot mask at zoom `s` (0 below the threshold), as in the Canvas2D path. */
export function dotsAt(f: FrameState, s: number): number {
  const th = f.dotThreshold;
  if (!f.flags.dots || s < th) return 0;
  return Math.min(1, (s - th) / (th * DOT_FADE_RAMP_FACTOR)) * MAX_BACKGROUND_DIM;
}

/** Draws brushes as instanced quads over the atlas' texture arrays: the sketch, then tiles coarse to fine. */
export class GLTilePass {
  private inst = new Float32Array(INSTANCE_FLOATS * INITIAL_INSTANCES);

  constructor(private readonly r: GLResources, private readonly atlas: TileAtlas) {}

  /** Sketch, then tiles coarse → fine, one draw per run of tiles sharing a texture array; returns draws issued. */
  draw(list: readonly BrushGeom[], v: PackView, s: number, opts: LayerOpts): number {
    const gl = this.r.gl;
    const need = (list.length + 1) * INSTANCE_FLOATS;
    if (this.inst.length < need) this.inst = new Float32Array(need * 2);
    const sketch = list[0]?.stratum === SKETCH_STRATUM ? list[0] : null;
    const tiles = sketch ? list.slice(1) : list;
    const groups: Array<{ first: number; count: number; array: number }> = [];
    let total = sketch ? packTiles([sketch], v, () => 0, this.inst) : 0;
    const sketchCount = total;
    for (const run of arrayRuns(tiles, (b) => this.atlas.slotOf(b.bmp)?.array)) {
      const count = packTiles(run.tiles, v, (b) => this.atlas.slotOf(b.bmp)?.layer ?? 0, this.inst, total);
      if (count > 0) groups.push({ first: total, count, array: run.array });
      total += count;
    }
    if (total === 0) return 0;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.r.tiles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.r.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.subarray(0, total * INSTANCE_FLOATS), gl.STREAM_DRAW);
    const smp = s < IMAGE_SMOOTHING_THRESHOLD ? this.r.linear : this.r.nearest;
    gl.bindSampler(0, smp);
    gl.bindSampler(1, smp);
    const n = dotsPerSide(s);
    const cells = DOT_TILE_CELLS;
    const tile = this.r.tile;
    this.r.frame(tile)
      .i1('uTiles', 0).i1('uSketch', 1).i1('uDotTile', 2)
      .f1('uDots', opts.dots).f1('uDotsPerPx', n).f1('uCellDev', (s * this.r.dpr) / n)
      .f2('uCellOffset', (((v.ox * n) % cells) + cells) % cells, (((v.oy * n) % cells) + cells) % cells)
      .f3('uUnder', GL_BG).f3('uClip', opts.clip ?? [0, 0, 0]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.r.dotTile);
    if (sketch && sketchCount > 0) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.atlas.sketchTexture(sketch.bmp));
      tile.i1('uIsSketch', 1);
      this.pointers(0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
    tile.i1('uIsSketch', 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const g of groups) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas.array(g.array) ?? null);
      this.pointers(g.first);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, g.count);
    }
    return total;
  }

  /** Instance attributes start at instance `first` (WebGL2 has no base-instance draw). */
  private pointers(first: number): void {
    const gl = this.r.gl;
    const base = first * STRIDE;
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, STRIDE, base);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, base + 4 * FLOAT_BYTES);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, base + 8 * FLOAT_BYTES);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, STRIDE, base + 12 * FLOAT_BYTES);
  }
}
