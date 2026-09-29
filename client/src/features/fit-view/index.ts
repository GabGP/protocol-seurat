import type { ViewState } from '../zoom-view';
import {
  FIT_BREAKPOINT_MOBILE,
  FIT_PAD_MOBILE,
  FIT_PAD_DESKTOP,
  FIT_TOP_CLEARANCE,
  FIT_BOTTOM_CLEARANCE,
  FIT_TOP_CLEARANCE_MOBILE,
  FIT_BOTTOM_CLEARANCE_MOBILE,
} from '@/shared/config/layout';

export function fitTarget(
  v: ViewState,
  w: number,
  h: number,
  iw: number,
  ih: number,
): { next: ViewState; fitS: number } {
  const isMobile = w < FIT_BREAKPOINT_MOBILE;
  const pad = isMobile ? FIT_PAD_MOBILE : FIT_PAD_DESKTOP;
  const top = isMobile ? FIT_TOP_CLEARANCE_MOBILE : FIT_TOP_CLEARANCE;
  const bot = isMobile ? FIT_BOTTOM_CLEARANCE_MOBILE : FIT_BOTTOM_CLEARANCE;
  const s = Math.min((w - pad * 2) / iw, (h - top - bot) / ih);
  const ttx = (w - iw * s) / 2;
  const tty = top + (h - top - bot - ih * s) / 2;
  return { next: { ...v, ts: s, ttx, tty, px: w / 2, py: h / 2 }, fitS: s };
}

export function applyFitImmediate(
  v: ViewState,
  w: number,
  h: number,
  iw: number,
  ih: number,
): { next: ViewState; fitS: number } {
  const { next, fitS } = fitTarget(v, w, h, iw, ih);
  return { next: { ...next, s: next.ts, tx: next.ttx, ty: next.tty }, fitS };
}
