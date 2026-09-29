import { MS_PER_S } from '@/shared/config/constants';
import { clamp } from '@/shared/lib/clamp';
import { relieve, warmShown } from './eviction';
import { flushReceipt } from './receipts';
import type { SinkState } from './state';

/**
 * The view the last MIRADA (numbered `seq`) described, image px. Moving away is what makes old
 * brushes evictable, once the old view's flows have landed; if that frees room, a RECIBO tells
 * the server the window reopened.
 */
export function setView(s: SinkState, x0: number, y0: number, x1: number, y1: number, vw: number, vh: number, seq: number): void {
  const nowS = performance.now() / MS_PER_S;
  const zoom = Math.log2(Math.max((x1 - x0) / Math.max(1, vw), (y1 - y0) / Math.max(1, vh)));
  const ideal = Number.isFinite(zoom) ? zoom : 0;
  const focus = clamp(Math.floor(ideal), 0, s.top - 1);
  warmShown(s, nowS);
  s.view = { x0, y0, x1, y1, focus };
  s.cones.look(s.view, seq);
  s.viewSince = nowS;
  s.gaze.observe(nowS, (x0 + x1) / 2, (y0 + y1) / 2, ideal, Math.hypot(x1 - x0, y1 - y0) / 2);
  if (relieve(s)) flushReceipt(s);
}

/** The viewer's brush cap changed: evict down to it (SOLTAR 1) or reopen the window, and tell the server in one RECIBO. */
export function relieveNow(s: SinkState): void {
  relieve(s);
  flushReceipt(s);
}

/**
 * §5.2.3's third trigger: the renderer could not reserve texture memory for new brushes.
 * Same eviction as under count/byte pressure (Horizon order, leaves only, SOLTAR 1).
 */
export function reportVramFailure(s: SinkState): void {
  if (relieve(s, true)) flushReceipt(s);
}
