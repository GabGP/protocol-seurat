import type { WorkPreview } from '@/entities/work/previews';
import { brushKey, makeBrushId } from '@/shared/proto/brush';
import { TILE } from '@/shared/config/constants';
import { PARENTS_PER_SIDE, type PreviewLoan } from './preview-loan';
import type { PreviewPiece } from './preview-piece';
import type { DecodedPlanes, PreviewDecoder } from './preview-decoder';
import type { BrushMemo } from './preview-memo';
import type { PreviewFinisher } from './preview-finisher';

/** One stratum down doubles each side. */
const LEVEL_SCALE = TILE / PARENTS_PER_SIDE;

/** A decoded level of the composite, with each brush's signature (the pieces it stands on). */
interface Level extends DecodedPlanes {
  sigs: Map<string, string>;
}

/**
 * The thumbnail a loan shows: the seed, then each stratum under it down to the finest one held,
 * over the whole area. A brush not (or no longer) held is predicted from its parent with zero
 * detail, as the viewer paints before bands arrive. Brushes whose pieces did not change since the
 * last compose come from `memo`, not the decoder. Kept at the card's width, not the stratum's,
 * by `finisher`, which takes the level's planes.
 */
export async function composePreview(
  loan: PreviewLoan, decoder: PreviewDecoder, memo: BrushMemo, finisher: PreviewFinisher,
): Promise<WorkPreview | null> {
  const seed = loan.seed;
  if (!seed) return null;
  const sig = String(seed.delivery);
  const planes = await memo.get('seed', sig, () => decoder.decode({
    ...request(loan, seed, [seed]), seed: true, seedWidth: loan.seedW, seedHeight: loan.seedH,
  }));
  let level: Level = { ...planes, sigs: new Map([['seed', sig]]) };
  for (let s = loan.top - 1; s >= Math.max(loan.level, loan.finest()); s--) level = await stratum(loan, decoder, memo, seed, level, s);
  memo.sweep();
  // The seed alone is the memo's own: the finisher gets a copy of it.
  const own = level.planes === planes.planes ? { ...level, planes: level.planes.map((p) => p.slice()) } : level;
  return finisher.finish(own, loan.vw);
}

/** Stratum `s` over the whole work, each brush decoded on its 128² crop of `parent`, all at once. */
async function stratum(
  loan: PreviewLoan, decoder: PreviewDecoder, memo: BrushMemo, seed: PreviewPiece, parent: Level, s: number,
): Promise<Level> {
  const out: Level = {
    planes: [0, 1, 2].map(() => new Int16Array(parent.width * parent.height * LEVEL_SCALE * LEVEL_SCALE)),
    width: parent.width * LEVEL_SCALE,
    height: parent.height * LEVEL_SCALE,
    sigs: new Map(),
  };
  const brushes: Promise<void>[] = [];
  for (let by = 0; by < loan.rows(s); by++) {
    for (let bx = 0; bx < loan.cols(s); bx++) {
      const run = loan.shown(s, bx, by);
      const base = run[0] ?? { ...seed, brushId: makeBrushId(s, bx, by), stratum: s, delivery: 0 };
      const above = s === loan.top - 1 ? parent.sigs.get('seed') : parent.sigs.get(`${s + 1}/${bx >> 1}/${by >> 1}`);
      const key = `${s}/${bx}/${by}`;
      const sig = `${run.map((p) => p.delivery).join(',')}<${above ?? ''}`;
      out.sigs.set(key, sig);
      const brush = memo.get(key, sig, () => decoder.decode({
        ...request(loan, base, run),
        parentPlanes: crop(parent, bx * PARENTS_PER_SIDE, by * PARENTS_PER_SIDE),
        parentPlaneWidth: PARENTS_PER_SIDE,
        parentPlaneHeight: PARENTS_PER_SIDE,
      }));
      brushes.push(brush.then((b) => place(b, out, bx * TILE, by * TILE)));
    }
  }
  await Promise.all(brushes);
  return out;
}

/** A decode of `head`'s brush from the bands of `run` in order (none: the parent's prediction). */
function request(loan: PreviewLoan, head: PreviewPiece, run: PreviewPiece[]) {
  return {
    delivery: head.delivery, stratum: head.stratum, qY: head.qY, qC: head.qC, seed: false, seedWidth: 0, seedHeight: 0,
    brush: `preview:${loan.handle}:${brushKey(head.brushId, head.edition)}`, edition: head.edition,
    bands: run.flatMap((p) => p.bands.map((b) => b.slice().buffer)), planesOnly: true,
  };
}

/** The 128² parent points under one brush, the edge repeated where the work ends (as the worker crops). */
function crop(src: DecodedPlanes, x0: number, y0: number): ArrayBuffer[] {
  return src.planes.map((p) => {
    const out = new Int16Array(PARENTS_PER_SIDE * PARENTS_PER_SIDE);
    for (let y = 0; y < PARENTS_PER_SIDE; y++) {
      const row = Math.min(src.height - 1, y0 + y) * src.width;
      for (let x = 0; x < PARENTS_PER_SIDE; x++) out[y * PARENTS_PER_SIDE + x] = p[row + Math.min(src.width - 1, x0 + x)] ?? 0;
    }
    return out.buffer;
  });
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
