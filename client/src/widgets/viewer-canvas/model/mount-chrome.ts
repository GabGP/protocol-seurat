import { createPointerGestures } from '@/features/pan-view';
import { attachShortcuts } from '@/features/viewer-shortcuts';
import { attachZoomGestures } from '@/features/zoom-view';
import { renderFlags as flags, subscribeRenderFlags } from '@/shared/lib/render-flags';
import { deviceDpr } from '@/shared/lib/dpr';
import type { ChromeCtx, ChromeProps, ChromeState } from './chrome-types';
import { watchContextLoss } from './context-loss';
import { createRenderer } from './create-renderer';
import { createFrameLoop } from './frame-loop';
import { createMeterView } from './meter-view';
import { createViewController } from './view-controller';

/** What React hands the imperative canvas: the canvas, the state that outlives it, and the ways back into React. */
export interface ChromeEnv {
  cv: HTMLCanvasElement;
  st: ChromeState;
  P(): ChromeProps;
  /** Requests a repaint from outside the loop (new paint, changed props). */
  wake: { current: () => void };
  meterEl(): HTMLElement | null;
  badgeEl(): HTMLElement | null;
  /** WebGL2 failed or lost its context for good on this viewer: Canvas2D until the switch is flipped again. */
  gpuFailed: { current: boolean };
  /** Remounts the canvas: a canvas keeps its first context type (WebGL2 or Canvas2D). */
  remountCanvas(): void;
  /** A lost context came back: a new renderer on the same canvas re-uploads what is held. */
  contextRestored(): void;
}

/** Wires one canvas: renderer, view, gestures, shortcuts, frame loop. Returns the teardown, or nothing when the canvas must be remounted first. */
export function mountChrome(env: ChromeEnv): (() => void) | undefined {
  const { cv, st, P, gpuFailed } = env;
  const frame = { W: 0, H: 0, dpr: 1, dirty: true };
  const ctx: ChromeCtx = { cv, st, P, frame };
  st.uiKey = '';
  st.pixelKey = '';
  env.wake.current = () => {
    frame.dirty = true;
  };
  const p0 = P();
  const work = `${p0.iw}x${p0.ih}#${p0.handle}`;
  if (st.work !== work) {
    st.work = work;
    st.userMoved = false;
  }
  const wantGpu = flags.gpu && !gpuFailed.current;
  const renderer = createRenderer(cv, wantGpu, { onVramFailure: () => P().sink?.reportVramFailure() });
  if (!renderer) {
    gpuFailed.current = true;
    env.remountCanvas();
    return undefined;
  }
  if (wantGpu && renderer.kind !== 'webgl2') gpuFailed.current = true; // no WebGL2 here

  const vc = createViewController(ctx);
  P().apiRef.current = vc.api;
  const gestures = createPointerGestures({
    canvas: cv,
    pointer: st.pointer,
    getView: () => st.v,
    setView: (v) => {
      st.v = v;
    },
    loupeOn: () => P().loupe,
    zoomTo: vc.zoomTo,
    moved: () => {
      st.userMoved = true;
    },
    changed: () => {
      frame.dirty = true;
    },
    pressed: () => P().actions.onCloseMenu(),
  });
  const meter = createMeterView(ctx, env.meterEl, renderer.kind);
  const loop = createFrameLoop(ctx, { renderer, vc, gestures, meter, badge: env.badgeEl });

  const resize = (): void => {
    const r = cv.getBoundingClientRect();
    frame.W = r.width;
    frame.H = r.height;
    frame.dpr = deviceDpr();
    cv.width = Math.round(r.width * frame.dpr);
    cv.height = Math.round(r.height * frame.dpr);
    renderer.resize(frame.W, frame.H, frame.dpr);
    if (!st.userMoved) vc.fit(true);
    frame.dirty = true;
    st.uiKey = '';
  };

  /** Settings changed: repaint now, and show or hide the meter. */
  function onFlags(): void {
    if (!flags.gpu) gpuFailed.current = false; // switching off, then on again, retries WebGL2
    if ((flags.gpu && !gpuFailed.current) !== wantGpu) {
      env.remountCanvas(); // renderer change: a canvas keeps its first context type
      return;
    }
    frame.dirty = true;
    meter.refresh();
    cv.parentElement?.toggleAttribute('data-meter', flags.fps); // overlays below make room
  }

  const ro = new ResizeObserver(resize);
  ro.observe(cv);
  const stops = [
    attachZoomGestures({ canvas: cv, scale: () => st.v.ts, zoomTo: vc.zoomTo }),
    gestures.attach(),
    attachShortcuts({
      actions: () => P().actions,
      zoomFrom: (next) => vc.zoomTo(next(st.v.ts)),
      zoomTo: (s) => vc.zoomTo(s),
      fit: vc.fit,
      nudge: vc.nudge,
    }),
    watchContextLoss(
      cv,
      () => {
        gpuFailed.current = true;
        env.remountCanvas();
      },
      env.contextRestored,
    ),
    subscribeRenderFlags(onFlags),
  ];
  onFlags();
  resize();
  loop.start();
  return () => {
    loop.stop();
    ro.disconnect();
    for (const stop of stops) stop();
    renderer.dispose();
    cv.parentElement?.removeAttribute('data-meter');
    env.wake.current = () => undefined;
  };
}
