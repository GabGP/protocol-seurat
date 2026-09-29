import { clamp } from '@/shared/lib/clamp';
import { MIN_ZOOM_FIT_RATIO } from '@/shared/config/view';
import { applyFitImmediate, fitTarget } from '@/features/fit-view';
import { zoomTarget } from '@/features/zoom-view';
import type { ChromeApi } from '@/entities/viewport';
import type { ChromeCtx } from './chrome-types';

export interface ViewController {
  /** Zoom from which pixels become dots. */
  th(): number;
  maxS(): number;
  minS(): number;
  fit(immediate: boolean): void;
  zoomTo(ns: number, px?: number, py?: number): void;
  /** Shifts the view target by CSS px. */
  nudge(dx: number, dy: number): void;
  api: ChromeApi;
}

/** Every imperative move of the view; the frame loop eases toward the target it sets. */
export function createViewController({ st, P, frame }: ChromeCtx): ViewController {
  const th = (): number => P().dotThreshold / 100;
  const maxS = (): number => P().maxZoom;
  const minS = (): number => st.fitS * MIN_ZOOM_FIT_RATIO;

  function fit(immediate: boolean): void {
    const p = P();
    const fitFn = immediate ? applyFitImmediate : fitTarget;
    const r = fitFn(st.v, frame.W, frame.H, p.iw, p.ih);
    st.v = r.next;
    st.fitS = r.fitS;
    st.userMoved = false;
    frame.dirty = true;
  }

  function zoomTo(ns: number, px?: number, py?: number): void {
    st.v = zoomTarget(st.v, ns, px ?? frame.W / 2, py ?? frame.H / 2, minS(), maxS());
    st.userMoved = true;
    frame.dirty = true;
  }

  const api: ChromeApi = {
    zoomTo,
    fit,
    panTo: (ix, iy) => {
      const v = st.v;
      st.v = { ...v, ttx: frame.W / 2 - ix * v.ts, tty: frame.H / 2 - iy * v.ts };
      st.userMoved = true;
      frame.dirty = true;
    },
    slideTo: (f) => {
      const lo = Math.log(minS());
      const hi = Math.log(maxS());
      zoomTo(Math.exp(lo + clamp(f, 0, 1) * (hi - lo)));
    },
  };

  return {
    th,
    maxS,
    minS,
    fit,
    zoomTo,
    nudge(dx, dy) {
      st.v = { ...st.v, ttx: st.v.ttx + dx, tty: st.v.tty + dy };
      frame.dirty = true;
    },
    api,
  };
}
