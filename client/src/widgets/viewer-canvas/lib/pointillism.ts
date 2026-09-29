import { hash3 } from '@/shared/lib/hash3';
import { TAU, DOT_SPACING_PX, DOT_TILE_CELLS, DOT_RADIUS_MIN, DOT_RADIUS_SPAN, DOT_JITTER_ROOM } from '@/shared/config/render';
import { placePattern } from './place-pattern';

/** Dots per image-pixel side: ~DOT_SPACING_PX apart on screen, never fewer than 2, so a pixel is always several dots. */
export function dotsPerSide(s: number): number {
  return Math.max(2, Math.round(s / DOT_SPACING_PX));
}

/**
 * One dot per cell of a DOT_TILE_CELLS² tile, in cell units. Jitter + radius stay under half a
 * cell, so a dot never leaves its cell, and cells tile each pixel exactly: no dot crosses a pixel edge.
 */
export function tileDots(): Array<{ x: number; y: number; r: number }> {
  const out: Array<{ x: number; y: number; r: number }> = [];
  for (let j = 0; j < DOT_TILE_CELLS; j++) {
    for (let i = 0; i < DOT_TILE_CELLS; i++) {
      const [h1, h2, h3] = hash3(i, j);
      const r = DOT_RADIUS_MIN + DOT_RADIUS_SPAN * h3;
      const room = DOT_JITTER_ROOM * (0.5 - r);
      out.push({ x: i + 0.5 + (2 * h1 - 1) * room, y: j + 0.5 + (2 * h2 - 1) * room, r });
    }
  }
  return out;
}

/**
 * The same dots as a DOT_TILE_CELLS² RGBA8 texture for the WebGL2 path: per cell, the dot's
 * centre within the cell (x, y) and radius, all in cell units × 255.
 */
export function dotParams(): Uint8Array {
  const out = new Uint8Array(DOT_TILE_CELLS * DOT_TILE_CELLS * 4);
  tileDots().forEach((d, k) => {
    const i = k % DOT_TILE_CELLS;
    const j = Math.floor(k / DOT_TILE_CELLS);
    out.set([Math.round((d.x - i) * 255), Math.round((d.y - j) * 255), Math.round(d.r * 255), 255], k * 4);
  });
  return out;
}

/** Tile origin near 0 that keeps the cell grid on the pixel grid (huge images pan to tx ≈ -1e7). */
export function patternOrigin(t: number, period: number): number {
  return t - Math.floor(t / period) * period;
}

const CELL_PX = 16;
const tiles = new Map<string, HTMLCanvasElement>();
const patterns = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasPattern>>();

/** A tile of `under` colour with the dots punched out (antialiased edges keep partial alpha). */
function holeTile(under: string): HTMLCanvasElement {
  const hit = tiles.get(under);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = DOT_TILE_CELLS * CELL_PX;
  const t = c.getContext('2d');
  if (t) {
    t.fillStyle = under;
    t.fillRect(0, 0, c.width, c.height);
    t.globalCompositeOperation = 'destination-out';
    t.beginPath();
    for (const d of tileDots()) {
      t.moveTo((d.x + d.r) * CELL_PX, d.y * CELL_PX);
      t.arc(d.x * CELL_PX, d.y * CELL_PX, d.r * CELL_PX, 0, TAU);
    }
    t.fill();
  }
  tiles.set(under, c);
  return c;
}

function holePattern(ctx: CanvasRenderingContext2D, under: string): CanvasPattern | null {
  let byColour = patterns.get(ctx);
  if (!byColour) {
    byColour = new Map();
    patterns.set(ctx, byColour);
  }
  const hit = byColour.get(under);
  if (hit) return hit;
  const p = ctx.createPattern(holeTile(under), 'repeat');
  if (p) byColour.set(under, p);
  return p;
}

export interface PointillismParams {
  tx: number;
  ty: number;
  s: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  /** How far the gaps between dots fade to `under` (0 = plain image, 1 = only dots). */
  amount: number;
  /** Colour under the image (what a fully faded gap shows). */
  under: string;
}

/**
 * Turns the image already drawn (opaque) into dots: every image pixel becomes dotsPerSide(s)²
 * dots of its own colour. One pattern fill of `under`, with holes where the dots are, locked to
 * the pixel grid and laid over at `amount`. Same result as masking a copy of the image with the
 * dots, without a second full-viewport canvas (a CPU readback in Firefox).
 */
export function drawPointillism(ctx: CanvasRenderingContext2D, params: PointillismParams): void {
  const { tx, ty, s, cx0, cy0, cx1, cy1, amount, under } = params;
  if (amount <= 0 || s <= 0 || cx1 <= cx0 || cy1 <= cy0) return;
  const pattern = holePattern(ctx, under);
  if (!pattern) return;
  const cell = s / dotsPerSide(s);
  const period = DOT_TILE_CELLS * cell;
  const k = cell / CELL_PX;
  placePattern(pattern, k, patternOrigin(tx, period), patternOrigin(ty, period));
  const alpha = ctx.globalAlpha;
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = Math.min(1, amount);
  ctx.fillStyle = pattern;
  ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  ctx.globalAlpha = alpha;
}
