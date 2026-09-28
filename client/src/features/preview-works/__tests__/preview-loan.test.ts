import { describe, expect, it } from 'vitest';
import { SEED_STRATUM } from '@/shared/config/constants';
import { makeBrushId, type BrushHead } from '@/shared/proto/brush';
import { PreviewLoan } from '../model/preview-loan';
import type { PreviewPiece } from '../model/preview-piece';

/** Bands [from, through) of brush (s, bx, by), delivery `n`. */
function piece(n: number, s: number, bx: number, by: number, from: number, through: number): PreviewPiece {
  return {
    delivery: n, brushId: makeBrushId(s, bx, by), stratum: s, bx, by, from, through,
    epoch: 0, edition: 0, qY: 1, qC: 1, bands: [], expires: n === 2 ? 0 : Infinity,
  };
}

/** A loan over a 3-stratum work holding the seed, brush 1/0/0 as bands [0,1) (lease up) + [1,2), and its child 0/1/1. */
function loan(): { loan: PreviewLoan; base: PreviewPiece; retouch: PreviewPiece; child: PreviewPiece } {
  const l = new PreviewLoan('w');
  Object.assign(l, { top: 2, seedW: 256, seedH: 256 });
  l.take(piece(1, SEED_STRATUM, 0, 0, 0, 1));
  const [retouch, child, base] = [piece(3, 1, 0, 0, 1, 2), piece(4, 0, 1, 1, 0, 1), piece(2, 1, 0, 0, 0, 1)];
  for (const p of [retouch, child, base]) l.take(p);
  return { loan: l, base, retouch, child };
}

/** The head of a delivery offering bands [from, through) of brush 1/0/0. */
const head = (from: number, through: number): BrushHead =>
  ({ stratum: 1, brushId: makeBrushId(1, 0, 0), from, through, edition: 0 }) as BrushHead;

describe('PreviewLoan', () => {
  it('shows a brush as its run of bands from 0, in band order whatever order they came in', () => {
    const { loan: l, base, retouch } = loan();
    expect(l.shown(1, 0, 0)).toEqual([base, retouch]);
    l.remove([base]);
    expect(l.shown(1, 0, 0)).toEqual([]);
    l.remove([retouch]);
    expect(l.wants(head(0, 2), 0, 0)).toBe(true);
  });

  it('wants no bands a held piece of the brush already covers', () => {
    const { loan: l } = loan();
    expect(l.wants(head(1, 2), 0, 0)).toBe(false);
    expect(l.wants(head(2, 3), 0, 0)).toBe(true);
  });

  it('expires a piece with every piece that stood on it: later bands and the brushes under it', () => {
    const { loan: l, retouch, child, base } = loan();
    expect(new Set(l.expired(1))).toEqual(new Set([base, retouch, child]));
  });
});
