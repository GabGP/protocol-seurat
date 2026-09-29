import {
  TAU, BG_COLOR, BG_GRID_COLOR, BG_GRID_SPACING, BG_GRID_DOT_RADIUS, BG_GRID_PARALLAX,
  FRAME_SHADOW_BLUR, FRAME_SHADOW_COLOR, SHADOW_REACH_PER_BLUR,
  LOUPE_RADIUS, LOUPE_SHADOW_BLUR, LOUPE_SHADOW_COLOR,
} from '@/shared/config/render';

/**
 * Everything static the viewer used to re-rasterize every frame (a ~3k-arc grid path and two
 * shadowBlur passes, CPU-side in Firefox) is rendered once per devicePixelRatio and then blitted.
 */

/** [sx, sy, sw, sh, dx, dy, dw, dh] in CSS px; source coords are sprite-local. */
export type Slice = [number, number, number, number, number, number, number, number];

/** Reach of a shadow sprite around its shape (CSS px). */
export const FRAME_REACH = Math.ceil(FRAME_SHADOW_BLUR * SHADOW_REACH_PER_BLUR);
/** Sprite side: two corners (reach outside + reach inside the edge) + a 2px stretchable middle. */
const FRAME_SPRITE = 4 * FRAME_REACH + 2;

/**
 * 9-slice of the frame shadow around rect (x,y,w,h), minus the centre (the frame's own black
 * fill covers it). Needs w,h >= 2·reach; smaller rects are cheap to blur directly.
 */
export function frameShadowSlices(x: number, y: number, w: number, h: number, reach = FRAME_REACH): Slice[] | null {
  if (w < 2 * reach || h < 2 * reach) return null;
  const c = 2 * reach;
  const src = [0, c, c + 2];
  const srcLen = [c, 2, c];
  const dst = (o: number, len: number): number[] => [o - reach, o + reach, o + len - reach];
  const dstLen = (len: number): number[] => [c, len - c, c];
  const dx = dst(x, w);
  const dy = dst(y, h);
  const dw = dstLen(w);
  const dh = dstLen(h);
  const at = (a: number[], i: number): number => a[i] ?? 0;
  const out: Slice[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue;
      out.push([at(src, i), at(src, j), at(srcLen, i), at(srcLen, j), at(dx, i), at(dy, j), at(dw, i), at(dh, j)]);
    }
  }
  return out;
}

/**
 * Up to four bands covering [0,W]×[0,H] minus `hole`, which is shrunk by 1px so the bands run
 * under the image's antialiased edge (the image is drawn after them).
 */
export function aroundHole(W: number, H: number, hole: { x0: number; y0: number; x1: number; y1: number } | null):
  Array<[number, number, number, number]> {
  if (!hole) return [[0, 0, W, H]];
  const x0 = Math.max(0, Math.ceil(hole.x0) + 1);
  const y0 = Math.max(0, Math.ceil(hole.y0) + 1);
  const x1 = Math.min(W, Math.floor(hole.x1) - 1);
  const y1 = Math.min(H, Math.floor(hole.y1) - 1);
  if (x1 <= x0 || y1 <= y0) return [[0, 0, W, H]];
  const out: Array<[number, number, number, number]> = [];
  if (y0 > 0) out.push([0, 0, W, y0]);
  if (y1 < H) out.push([0, y1, W, H - y1]);
  if (x0 > 0) out.push([0, y0, x0, y1 - y0]);
  if (x1 < W) out.push([x1, y0, W - x1, y1 - y0]);
  return out;
}

function canvas(cssSide: number, dpr: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(cssSide * dpr);
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, g };
}

/**
 * Only the shadow of `shape`: the shape is drawn `shift` px to the left (off the target) and its
 * shadow offset back in. shadowBlur and shadow offsets ignore the transform, hence `* dpr`.
 */
function shadowOnly(g: CanvasRenderingContext2D, dpr: number, shift: number, offY: number, blur: number,
  color: string, shape: (dx: number) => void): void {
  g.shadowColor = color;
  g.shadowBlur = blur * dpr;
  g.shadowOffsetX = shift * dpr;
  g.shadowOffsetY = offY * dpr;
  g.fillStyle = '#000';
  shape(-shift);
}

export class ViewerSprites {
  private dpr = 0;
  private gridTile: HTMLCanvasElement | null = null;
  private gridPattern: CanvasPattern | null = null;
  /** Grid period in CSS px: a whole number of device px, so the pattern maps 1:1 (no filtering). */
  private gridPeriod: number = BG_GRID_SPACING;
  private frame: HTMLCanvasElement | null = null;
  private loupe: HTMLCanvasElement | null = null;

  /** (Re)build every sprite for this ratio; a no-op while the ratio holds. */
  ensure(ctx: CanvasRenderingContext2D, dpr: number): void {
    if (dpr === this.dpr) return;
    this.dpr = dpr;
    const tilePx = Math.max(1, Math.round(BG_GRID_SPACING * dpr));
    const tile = document.createElement('canvas');
    tile.width = tile.height = tilePx;
    const t = tile.getContext('2d');
    if (t) {
      const k = tilePx / BG_GRID_SPACING;
      t.fillStyle = BG_COLOR;
      t.fillRect(0, 0, tilePx, tilePx);
      t.fillStyle = BG_GRID_COLOR;
      t.beginPath();
      t.arc(tilePx / 2, tilePx / 2, BG_GRID_DOT_RADIUS * k, 0, TAU);
      t.fill();
    }
    this.gridTile = tile;
    this.gridPeriod = tilePx / dpr;
    this.gridPattern = ctx.createPattern(tile, 'repeat');

    const f = canvas(FRAME_SPRITE, dpr);
    if (f) {
      const r = FRAME_REACH;
      shadowOnly(f.g, dpr, FRAME_SPRITE, 0, FRAME_SHADOW_BLUR, FRAME_SHADOW_COLOR,
        (dx) => f.g.fillRect(r + dx, r, 2 * r + 2, 2 * r + 2));
    }
    this.frame = f?.c ?? null;

    const lr = LOUPE_RADIUS + Math.ceil(LOUPE_SHADOW_BLUR * SHADOW_REACH_PER_BLUR);
    const l = canvas(2 * lr, dpr);
    if (l) {
      l.g.shadowColor = LOUPE_SHADOW_COLOR;
      l.g.shadowBlur = LOUPE_SHADOW_BLUR * dpr;
      l.g.fillStyle = BG_COLOR;
      l.g.beginPath();
      l.g.arc(lr, lr, LOUPE_RADIUS, 0, TAU);
      l.g.fill();
    }
    this.loupe = l?.c ?? null;
  }

  /**
   * Background + parallax dot grid, painted only around `hole` (the opaque image, CSS px): when
   * the image fills the view this costs nothing. The pattern sits on whole device px (1:1 copy).
   * `grid=false` leaves the plain colour.
   */
  drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number, tx: number, ty: number, grid: boolean,
    hole: { x0: number; y0: number; x1: number; y1: number } | null): void {
    const g = this.gridPeriod;
    const d = this.dpr;
    const p = grid ? this.gridPattern : null;
    if (p && this.gridTile) {
      const ox = (((tx * BG_GRID_PARALLAX) % g) + g) % g - g / 2;
      const oy = (((ty * BG_GRID_PARALLAX) % g) + g) % g - g / 2;
      placePattern(p, 1 / d, Math.round(ox * d) / d, Math.round(oy * d) / d);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = p;
    } else {
      ctx.fillStyle = BG_COLOR;
    }
    for (const [x, y, w, h] of aroundHole(W, H, hole)) ctx.fillRect(x, y, w, h);
  }

  /** Shadow only (no fill) of the frame rect (x,y,w,h), dropped by `offY`. */
  drawFrameShadow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, offY: number): void {
    const slices = this.frame ? frameShadowSlices(x, y + offY, w, h) : null;
    if (!slices || !this.frame) {
      ctx.save();
      shadowOnly(ctx, this.dpr, x + w + FRAME_REACH, offY, FRAME_SHADOW_BLUR, FRAME_SHADOW_COLOR,
        (dx) => ctx.fillRect(x + dx, y, w, h));
      ctx.restore();
      return;
    }
    const d = this.dpr;
    ctx.imageSmoothingEnabled = true;
    for (const [sx, sy, sw, sh, dx, dy, dw, dh] of slices) {
      ctx.drawImage(this.frame, sx * d, sy * d, sw * d, sh * d, dx, dy, dw, dh);
    }
  }

  /** Loupe disc (background fill + soft shadow) centred on (x,y). */
  drawLoupeDisc(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    if (!this.loupe) return;
    const side = this.loupe.width / this.dpr;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.loupe, x - side / 2, y - side / 2, side, side);
  }
}

let scratchMatrix: DOMMatrix | null = null;

/**
 * Scale-and-translate a pattern through one reused DOMMatrix: the original code's proven form
 * (a plain-object argument is newer API), minus a per-frame allocation.
 */
export function placePattern(p: CanvasPattern, k: number, e: number, f: number): void {
  const m = scratchMatrix ?? (scratchMatrix = new DOMMatrix());
  m.a = k;
  m.b = 0;
  m.c = 0;
  m.d = k;
  m.e = e;
  m.f = f;
  p.setTransform(m);
}
