import { matchesScrape } from '@/entities/delivery';
import { MS_PER_S, SEED_STRATUM, TILE } from '@/shared/config/constants';
import { makeBrushId, parentBrushId, type BrushHead } from '@/shared/proto/brush';
import type { Scrape } from '@/shared/proto/messages';
import { pieceRecord, type PreviewPiece } from './preview-piece';

/** Parent points under one brush of the stratum below, per side (a brush holds 128 × 128 parents). */
export const PARENTS_PER_SIDE = TILE / 2;

/**
 * The loans behind one gallery thumbnail (spec 5): the seed plus whatever the card's cone
 * brought down to `level`, retouches included, held like any other delivery. Pure accounting:
 * renew, scrape, audit and expiry answer from here; the manager does the talking.
 */
export class PreviewLoan {
  seed: PreviewPiece | null = null;
  readonly kids = new Map<number, PreviewPiece>();
  /** The kids by brush, each brush's pieces by first band: a lookup, not a scan of every kid. */
  private readonly byBrush = new Map<bigint, PreviewPiece[]>();
  renewThrough = 0;
  handle = 0;
  seedW = 0;
  seedH = 0;
  /** The work's top stratum (`strata − 1`); 0 when the seed is the whole work. */
  top = 0;
  /** Finest stratum the card needs: what its MIRADA makes the cone's focus. */
  level = 0;
  workW = 0;
  workH = 0;
  /** When the card last sent its MIRADA (performance.now ms). */
  gazedAt = 0;
  /** The card's width in device pixels: the MIRADA's `vw`, and the width the thumbnail is kept at. */
  vw = 0;

  constructor(readonly id: string) {}

  /** Brushes across stratum `s`: the level is seedW · 2^(top − s) points wide, 256 per brush. */
  cols(s: number): number {
    return Math.ceil((this.seedW * 2 ** (this.top - s)) / TILE);
  }

  rows(s: number): number {
    return Math.ceil((this.seedH * 2 ** (this.top - s)) / TILE);
  }

  /** The seed while none is held, or new bands of a brush between the seed and `level`, of the seed's edition. */
  wants(h: BrushHead, bx: number, by: number): boolean {
    if (h.stratum === SEED_STRATUM) return h.from === 0 && this.seed === null;
    if (h.stratum < this.level || h.stratum >= this.top) return false;
    if (bx >= this.cols(h.stratum) || by >= this.rows(h.stratum)) return false;
    if (this.seed !== null && h.edition !== this.seed.edition) return false;
    return this.brush(h.brushId).every((k) => k.through <= h.from || k.from >= h.through);
  }

  /** Holds a wanted piece; a seed disowns brushes of another edition, returned for release. */
  take(piece: PreviewPiece): PreviewPiece[] {
    if (piece.stratum !== SEED_STRATUM) {
      this.kids.set(piece.delivery, piece);
      const run = [...this.brush(piece.brushId), piece].sort((a, b) => a.from - b.from);
      this.byBrush.set(piece.brushId, run);
      return [];
    }
    this.seed = piece;
    const stale = [...this.kids.values()].filter((k) => k.edition !== piece.edition);
    this.remove(stale);
    return stale;
  }

  /** The pieces a brush shows: its bands in a run from band 0 (a retouch without its base waits). */
  shown(s: number, bx: number, by: number): PreviewPiece[] {
    const run: PreviewPiece[] = [];
    for (const k of this.brush(makeBrushId(s, bx, by))) {
      if (k.from !== (run.at(-1)?.through ?? 0)) break;
      run.push(k);
    }
    return run;
  }

  /** The finest stratum any brush is held at; `top` (the seed) when there is none. */
  finest(): number {
    return Math.min(this.top, ...[...this.kids.values()].map((k) => k.stratum));
  }

  pieces(): PreviewPiece[] {
    return [...(this.seed ? [this.seed] : []), ...this.kids.values()].sort((a, b) => a.delivery - b.delivery);
  }

  remove(gone: PreviewPiece[]): void {
    for (const g of gone) {
      if (g === this.seed) this.seed = null;
      if (!this.kids.delete(g.delivery)) continue;
      const run = this.brush(g.brushId).filter((k) => k !== g);
      if (run.length > 0) this.byBrush.set(g.brushId, run);
      else this.byBrush.delete(g.brushId);
    }
  }

  renew(ranges: number[], leaseS: number, now: number): void {
    const renewed = new Set(ranges);
    for (const p of this.pieces()) if (renewed.has(p.delivery)) p.expires = now + leaseS * MS_PER_S;
  }

  /** Spec 5.2.2: pieces past their lease, with everything that stood on them. */
  expired(now: number): PreviewPiece[] {
    return this.closure(this.pieces().filter((p) => p.expires <= now));
  }

  /** RASPAR (spec 4.2.4): the predicate over what is held ≤ N, with what stood on it (ancestor-closed). */
  scrape(r: Scrape): { scraped: PreviewPiece[]; kept: number[] } {
    const hit = this.pieces().filter((p) => p.delivery <= r.through && matchesScrape(pieceRecord(p), r.predicate, r.params));
    const scraped = this.closure(hit);
    this.remove(scraped);
    return { scraped, kept: this.numbersThrough(r.through) };
  }

  numbersThrough(through: number): number[] {
    return this.pieces().filter((p) => p.delivery <= through).map((p) => p.delivery);
  }

  /** `gone` plus every piece that stood on it: later bands of its brush, brushes under a lost base band. */
  private closure(gone: PreviewPiece[]): PreviewPiece[] {
    const out = new Set(gone);
    if (this.seed && out.has(this.seed)) return this.pieces();
    const lost = (id: bigint, below: number): boolean => this.brush(id).some((o) => o.from < below && out.has(o));
    const coarseFirst = [...this.kids.values()].sort((a, b) => b.stratum - a.stratum || a.from - b.from);
    for (const k of coarseFirst) {
      const parent = k.stratum + 1 < this.top && lost(parentBrushId(k.stratum, k.bx, k.by, this.top), 1);
      if (!out.has(k) && (parent || lost(k.brushId, k.from))) out.add(k);
    }
    return [...out];
  }

  private brush(id: bigint): readonly PreviewPiece[] {
    return this.byBrush.get(id) ?? [];
  }
}
