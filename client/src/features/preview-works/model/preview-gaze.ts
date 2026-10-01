import { MFLAGS_STILL } from '@/shared/proto/messages';
import { PREVIEW_GAZE_KEEPALIVE_MS } from '@/shared/config/constants';
import type { PreviewLoan } from './preview-loan';
import type { PreviewReplies } from './preview-replies';
import { clamp } from '@/shared/lib/clamp';

/** The MIRADA a card sends: the whole work, seen at the card's device pixels, not moving. */
export interface PreviewGaze {
  handle: number;
  seq: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  vw: number;
  vh: number;
  flags: number;
}

export function previewGaze(loan: PreviewLoan, workW: number, workH: number, seq: number): PreviewGaze {
  const vh = Math.max(1, Math.round((loan.vw * workH) / workW));
  return { handle: loan.handle, seq, x0: 0, y0: 0, x1: workW, y1: workH, vw: loan.vw, vh, flags: MFLAGS_STILL };
}

/**
 * The stratum that gaze makes the cone's focus (spec 2.2, s_i): the
 * coarsest one still at least as wide as the card, never the seed's.
 */
export function gazeLevel(g: PreviewGaze, top: number): number {
  const ideal = Math.floor(Math.log2(Math.max((g.x1 - g.x0) / g.vw, (g.y1 - g.y0) / g.vh)));
  return clamp(ideal, 0, top - 1);
}

/** Each card still showing looks at its work again before the server floors it (inactivity). */
export function keepGazing(loans: Iterable<PreviewLoan>, replies: PreviewReplies, now: number): void {
  for (const loan of loans) {
    if (loan.top > 0 && now - loan.gazedAt >= PREVIEW_GAZE_KEEPALIVE_MS) replies.gaze(loan, now);
  }
}
