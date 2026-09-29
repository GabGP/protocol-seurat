import type { DeliveryRecord } from '@/entities/delivery/store';
import { toKib } from '@/shared/config/constants';

/** One delivery a thumbnail holds: the seed, or bands [from, through) of one brush under it. */
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

/** KiB the pieces' bands take, as RASPADO / INVENTARIO report them. */
export function piecesKib(pieces: PreviewPiece[]): number {
  return pieces.reduce((kib, p) => kib + toKib(p.bands.reduce((n, b) => n + b.length, 0)), 0);
}

/** The piece as the scrape predicates read a delivery (spec 4.2.4). */
export function pieceRecord(p: PreviewPiece): DeliveryRecord {
  return {
    delivery: p.delivery, brushId: p.brushId, stratum: p.stratum, from: p.from, through: p.through,
    bytes: 0, epoch: p.epoch, edition: p.edition, expires: p.expires, rgba: null,
  };
}
