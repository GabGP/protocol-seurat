import { viewToRoi } from '@/entities/viewport';
import { logFrac } from '@/shared/lib/zoom';
import type { ChromeCtx } from './chrome-types';
import { syncReadout } from './readout';
import type { ViewController } from './view-controller';

/**
 * Frame-rate state goes to feeds (minimap, pill); the page re-renders only when what it
 * shows (zoom %, slider, dots) changes.
 */
export function syncUI(ctx: ChromeCtx, vc: ViewController): void {
  const { st, P, frame } = ctx;
  const p = P();
  const v = st.v;
  const { W, H } = frame;
  p.viewFeed.set({ s: v.s, tx: v.tx, ty: v.ty, w: W, h: H });
  syncReadout(ctx);
  const frac = logFrac(v.s, vc.minS(), vc.maxS());
  const pct = v.s * 100;
  const inDots = v.s >= vc.th();
  const key = pct.toFixed(2) + '|' + frac.toFixed(4) + '|' + inDots;
  if (key !== st.uiKey) {
    st.uiKey = key;
    p.onSync({ s: v.s, tx: v.tx, ty: v.ty, pct, frac, fitPct: st.fitS * 100, inDots, w: W, h: H });
  }
}

/** The sink hears the view through the gaze service, and evicts what we moved away from. */
export function reportGaze({ st, P, frame }: ChromeCtx): void {
  const p = P();
  if (!p.gazeService) return;
  const { W, H } = frame;
  const roi = viewToRoi(st.v.s, st.v.tx, st.v.ty, { vw: W, vh: H }, p.iw, p.ih);
  p.gazeService.motion({ handle: p.handle, x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1, vw: Math.round(W), vh: Math.round(H), flags: 0 });
}
