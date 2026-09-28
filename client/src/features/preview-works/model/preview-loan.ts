import { matchesScrape } from '@/entities/delivery/scrape';
import type { DeliveryRecord } from '@/entities/delivery/store';
import { SEED_STRATUM, TILE } from '@/shared/config/constants';
import type { BrushHead } from '@/shared/proto/brush';
import type { Scrape } from '@/shared/proto/messages';

/** Seed points under one brush of the stratum below it, per side (a brush holds 128 × 128 parents). */
export const PARENTS_PER_SIDE = TILE / 2;
const KIB = 1024;

/** One delivery a thumbnail holds: the seed, or a brush of the stratum right under it. */
export interface PreviewPiece {
  delivery: number;
  brushId: bigint;
  stratum: number;
  bx: number;
  by: number;
  from: number;
  through: number;
  epoch: number;
  edition: number;
  qY: number;
  qC: number;
  /** Verified wire bands: the source every recomposition decodes again. */
  bands: Uint8Array[];
  expires: number;
}

/**
 * The loans behind one gallery thumbnail (spec 5): the seed plus the ≤ 4 brushes of stratum
 * top − 1, held like any other delivery. Pure accounting: renew, scrape, audit and expiry
 * answer from here; the manager does the talking.
 */
export class PreviewLoan {
  seed: PreviewPiece | null = null;
  readonly kids = new Map<number, PreviewPiece>();
  renewThrough = 0;
  handle = 0;
  seedW = 0;
  seedH = 0;
  /** The work's top stratum (`strata − 1`); 0 when the seed is the whole work. */
  top = 0;

  constructor(readonly id: string) {}

  /** Brushes across and down stratum top − 1: one per 128 seed points (none when there is no such stratum). */
  cols(): number {
    return this.top < 1 ? 0 : Math.ceil(this.seedW / PARENTS_PER_SIDE);
  }

  rows(): number {
    return this.top < 1 ? 0 : Math.ceil(this.seedH / PARENTS_PER_SIDE);
  }

  /** Brushes still to come: what RECIBO.libre asks for, so the rest of the sketch stays on the server. */
  missing(): number {
    return Math.max(0, this.cols() * this.rows() - this.kids.size);
  }

  /** The seed while none is held, or a new band-0 brush of top − 1 inside the seed, of the seed's edition. */
  wants(h: BrushHead, bx: number, by: number): boolean {
    if (h.from !== 0) return false;
    if (h.stratum === SEED_STRATUM) return this.seed === null;
    if (h.stratum !== this.top - 1 || bx >= this.cols() || by >= this.rows()) return false;
    if (this.seed !== null && h.edition !== this.seed.edition) return false;
    return ![...this.kids.values()].some((k) => k.brushId === h.brushId);
  }

  /** Holds a wanted piece; a seed disowns brushes of another edition, returned for release. */
  take(piece: PreviewPiece): PreviewPiece[] {
    if (piece.stratum !== SEED_STRATUM) {
      this.kids.set(piece.delivery, piece);
      return [];
    }
    this.seed = piece;
    const stale = [...this.kids.values()].filter((k) => k.edition !== piece.edition);
    this.remove(stale);
    return stale;
  }

  pieces(): PreviewPiece[] {
    return [...(this.seed ? [this.seed] : []), ...this.kids.values()].sort((a, b) => a.delivery - b.delivery);
  }

  remove(gone: PreviewPiece[]): void {
    for (const g of gone) {
      if (g === this.seed) this.seed = null;
      this.kids.delete(g.delivery);
    }
  }

  renew(ranges: number[], leaseS: number, now: number): void {
    const renewed = new Set(ranges);
    for (const p of this.pieces()) if (renewed.has(p.delivery)) p.expires = now + leaseS * 1000;
  }

  /** Spec 5.2.2: a brush lives no longer than its parent, so an expired seed takes every brush with it. */
  expired(now: number): PreviewPiece[] {
    if (this.seed && this.seed.expires <= now) return this.pieces();
    return [...this.kids.values()].filter((k) => k.expires <= now);
  }

  /** RASPAR (spec 4.2.4): the predicate over what is held ≤ N; a scraped seed takes its brushes (ancestor-closed). */
  scrape(r: Scrape): { scraped: PreviewPiece[]; kept: number[] } {
    const hit = this.pieces().filter((p) => p.delivery <= r.through && matchesScrape(record(p), r.predicate, r.params));
    const scraped = this.seed && hit.includes(this.seed) ? this.pieces() : hit;
    this.remove(scraped);
    return { scraped, kept: this.numbersThrough(r.through) };
  }

  numbersThrough(through: number): number[] {
    return this.pieces().filter((p) => p.delivery <= through).map((p) => p.delivery);
  }
}

/** KiB the pieces' bands take, as RASPADO / INVENTARIO report them. */
export function piecesKib(pieces: PreviewPiece[]): number {
  return pieces.reduce((kib, p) => kib + Math.ceil(p.bands.reduce((n, b) => n + b.length, 0) / KIB), 0);
}

function record(p: PreviewPiece): DeliveryRecord {
  return {
    delivery: p.delivery, brushId: p.brushId, stratum: p.stratum, from: p.from, through: p.through,
    bytes: 0, epoch: p.epoch, edition: p.edition, expires: p.expires, rgba: null,
  };
}
