import type { WorkPreview } from '@/entities/work/previews';
import { brushKey, makeBrushId } from '@/shared/proto/brush';
import { TILE } from '@/shared/config/constants';
import { yCoCgToRgb } from '@/shared/codec/ycocgr';
import { PARENTS_PER_SIDE, type PreviewLoan, type PreviewPiece } from './preview-loan';
import type { DecodedPlanes, PreviewDecoder } from './preview-decoder';

const RGBA = 4;
const OPAQUE = 255;
/** One stratum down doubles each side. */
const LEVEL_SCALE = TILE / PARENTS_PER_SIDE;

/**
 * The thumbnail a loan shows: the seed alone, or stratum top − 1 over its whole area once the
 * seed has brushes under it. A brush not (or no longer) held is filled from the seed with zero
 * detail, the same prediction the viewer paints before bands arrive.
 */
export async function composePreview(loan: PreviewLoan, decoder: PreviewDecoder): Promise<WorkPreview | null> {
  const seed = loan.seed;
  if (!seed) return null;
  const base = await decoder.decode({
    ...request(loan, seed), seed: true, seedWidth: loan.seedW, seedHeight: loan.seedH,
  });
  if (loan.kids.size === 0) return toRgba(base);
  const out: DecodedPlanes = {
    planes: [0, 1, 2].map(() => new Int16Array(base.width * base.height * LEVEL_SCALE * LEVEL_SCALE)),
    width: base.width * LEVEL_SCALE,
    height: base.height * LEVEL_SCALE,
  };
  const held = new Map([...loan.kids.values()].map((k) => [`${k.bx},${k.by}`, k]));
  for (let by = 0; by < loan.rows(); by++) {
    for (let bx = 0; bx < loan.cols(); bx++) {
      const kid = held.get(`${bx},${by}`);
      const brush = await decoder.decode({
        ...(kid ? request(loan, kid) : filler(loan, seed, bx, by)),
        parentPlanes: base.planes.map((p) => p.slice().buffer),
        parentPlaneWidth: base.width,
        parentPlaneHeight: base.height,
        parentX: bx * PARENTS_PER_SIDE,
        parentY: by * PARENTS_PER_SIDE,
      });
      place(brush, out, bx * TILE, by * TILE);
    }
  }
  return toRgba(out);
}

function request(loan: PreviewLoan, p: PreviewPiece) {
  return {
    delivery: p.delivery, stratum: p.stratum, qY: p.qY, qC: p.qC, seed: false, seedWidth: 0, seedHeight: 0,
    brush: `preview:${loan.handle}:${brushKey(p.brushId, p.edition)}`, edition: p.edition,
    bands: p.bands.map((b) => b.slice().buffer),
  };
}

/** A brush the loan does not hold: no bands, so the worker predicts it from the seed alone. */
function filler(loan: PreviewLoan, seed: PreviewPiece, bx: number, by: number) {
  const id = makeBrushId(loan.top - 1, bx, by);
  return { ...request(loan, { ...seed, brushId: id, stratum: loan.top - 1, bands: [] }), delivery: 0 };
}

/** Copies a 256² brush into the composite, clipped where the work ends inside the brush. */
function place(src: DecodedPlanes, dst: DecodedPlanes, x0: number, y0: number): void {
  const w = Math.min(src.width, dst.width - x0);
  const h = Math.min(src.height, dst.height - y0);
  for (let c = 0; c < dst.planes.length; c++) {
    const from = src.planes[c];
    const to = dst.planes[c];
    if (!from || !to) continue;
    for (let y = 0; y < h; y++) to.set(from.subarray(y * src.width, y * src.width + w), (y0 + y) * dst.width + x0);
  }
}

function toRgba(d: DecodedPlanes): WorkPreview {
  const [Y, Co, Cg] = d.planes;
  const px = d.width * d.height;
  const rgba = new Uint8ClampedArray(px * RGBA);
  for (let i = 0; i < px; i++) {
    const { r, g, b } = yCoCgToRgb(Y?.[i] ?? 0, Co?.[i] ?? 0, Cg?.[i] ?? 0);
    const o = i * RGBA;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = OPAQUE;
  }
  return { rgba, width: d.width, height: d.height };
}
