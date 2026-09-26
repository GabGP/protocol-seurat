import {
  ZOOM_EPSILON,
  ZOOM_LERP_FACTOR,
  PAN_EPSILON,
  PAN_LERP_FACTOR,
} from '@/shared/config/view';

export interface ViewState {
  s: number;
  tx: number;
  ty: number;
  ts: number;
  ttx: number;
  tty: number;
  px: number;
  py: number;
}

export function initialView(): ViewState {
  return { s: 1, tx: 0, ty: 0, ts: 1, ttx: 0, tty: 0, px: 0, py: 0 };
}

export function tickView(v: ViewState): { next: ViewState; moving: boolean } {
  const next = { ...v };
  let moving = false;
  const lr = Math.log(v.ts / v.s);
  const zooming = Math.abs(lr) > ZOOM_EPSILON;

  if (zooming) {
    const ns = v.s * Math.exp(lr * ZOOM_LERP_FACTOR);
    next.tx = v.px - (v.px - v.tx) * (ns / v.s);
    next.ty = v.py - (v.py - v.ty) * (ns / v.s);
    next.s = ns;
    moving = true;
  } else if (v.s !== v.ts) {
    next.tx = v.px - (v.px - v.tx) * (v.ts / v.s);
    next.ty = v.py - (v.py - v.ty) * (v.ts / v.s);
    next.s = v.ts;
    moving = true;
  }

  // Pure zoom moves tx/ty to match target scale ts. Any independent pan delta
  // (e.g. from fling, panTo, or fit) is the difference beyond the zoom target:
  const zoomTtx = v.px - (v.px - next.tx) * (v.ts / next.s);
  const zoomTty = v.py - (v.py - next.ty) * (v.ts / next.s);
  const panDx = v.ttx - zoomTtx;
  const panDy = v.tty - zoomTty;

  if (Math.abs(panDx) > PAN_EPSILON || Math.abs(panDy) > PAN_EPSILON) {
    next.tx += panDx * PAN_LERP_FACTOR;
    next.ty += panDy * PAN_LERP_FACTOR;
    next.ttx = v.ttx;
    next.tty = v.tty;
    moving = true;
  } else {
    next.ttx = zoomTtx;
    next.tty = zoomTty;
  }

  return { next, moving };
}
