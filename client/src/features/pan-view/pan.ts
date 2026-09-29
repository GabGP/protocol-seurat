import type { ViewState } from '../zoom-view';
import { FLING_TRAVEL_MS } from '@/shared/config/view';

export function panBy(v: ViewState, dx: number, dy: number): ViewState {
  return { ...v, tx: v.tx + dx, ttx: v.ttx + dx, ty: v.ty + dy, tty: v.tty + dy };
}

export function flingTarget(v: ViewState, vx: number, vy: number): ViewState {
  return { ...v, ttx: v.ttx + vx * FLING_TRAVEL_MS, tty: v.tty + vy * FLING_TRAVEL_MS };
}

export function miniPanView(v: ViewState, ix: number, iy: number, w: number, h: number): ViewState {
  return { ...v, ttx: w / 2 - ix * v.ts, tty: h / 2 - iy * v.ts };
}
