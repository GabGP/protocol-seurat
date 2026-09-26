import { clamp } from '@/shared/lib/clamp';
import {
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  PINCH_SCALE_FACTOR,
  WHEEL_SCALE_FACTOR,
} from '@/shared/config/view';
import type { ViewState } from './model';

export function zoomTarget(
  v: ViewState,
  ns: number,
  px: number,
  py: number,
  minS: number,
  maxS: number,
): ViewState {
  const c = clamp(ns, minS, maxS);
  return {
    ...v,
    ts: c,
    ttx: px - (px - v.tx) * (c / v.s),
    tty: py - (py - v.ty) * (c / v.s),
    px,
    py,
  };
}

export function wheelZoom(ts: number, deltaY: number, mode: number, ctrl: boolean): number {
  const dy = deltaY * (mode === 1 ? WHEEL_LINE_PX : mode === 2 ? WHEEL_PAGE_PX : 1);
  return ts * Math.exp(-dy * (ctrl ? PINCH_SCALE_FACTOR : WHEEL_SCALE_FACTOR));
}
