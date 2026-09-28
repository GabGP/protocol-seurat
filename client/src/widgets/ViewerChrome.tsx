import { useEffect, useRef, useState } from 'react';
import { clamp } from '@/shared/lib/clamp';
import { samplePixelHex } from './pixel-sample';
import { collectBrushes, type BrushGeom } from './brush-cull';
import { createRenderer } from './create-renderer';
import { FrameMeter } from './frame-meter';
import { renderFlags as flags, subscribeRenderFlags } from '@/shared/lib/render-flags';
import type { Feed } from '@/shared/lib/feed';
import { logFrac } from '@/shared/lib/zoom';
import { applyFitImmediate, fitTarget } from '@/features/fit-view';
import { flingTarget, panBy } from '@/features/pan-view';
import { wheelZoom, zoomTarget } from '@/features/zoom-view';
import { initialView, tickView } from '@/features/zoom-view/model';
import { viewToRoi } from '@/entities/viewport/math';
import type { DeliverySink } from '@/app/providers/delivery-sink';
import type { GazeSender } from '@/features/send-gaze';
import { GL_RESTORE_WAIT_MS, LOUPE_MAGNIFICATION, LOUPE_RADIUS, LOUPE_BADGE_HEIGHT, LOUPE_BADGE_OFFSET_Y } from '@/shared/config/render';
import {
  MIN_ZOOM_FIT_RATIO,
  DBLCLICK_ZOOM_IN,
  DBLCLICK_ZOOM_OUT,
  KEY_PAN_STEP_PX,
  ZOOM_STEP_FACTOR,
  VELOCITY_EMA_ALPHA,
  VELOCITY_EMA_BETA,
  FLING_WINDOW_MS,
} from '@/shared/config/view';
import styles from './ViewerChrome.module.css';

export interface ViewSync {
  s: number;
  tx: number;
  ty: number;
  pct: number;
  frac: number;
  fitPct: number;
  inDots: boolean;
  w: number;
  h: number;
}

/** Where the view is, published every moving frame (minimap), outside React. */
export interface ViewRect {
  s: number;
  tx: number;
  ty: number;
  w: number;
  h: number;
}

/** Pixel under the pointer (status pill), published only when it changes. */
export interface PixelReadout {
  x: string;
  y: string;
  hex: string | null;
}

export const sameViewRect = (a: ViewRect | null, b: ViewRect | null): boolean =>
  a === b || (!!a && !!b && a.s === b.s && a.tx === b.tx && a.ty === b.ty && a.w === b.w && a.h === b.h);

export const sameReadout = (a: PixelReadout | null, b: PixelReadout | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.hex === b.hex);

/** Glass blur stays off this long after motion ends (no flicker between gesture frames). */
const MOTION_SETTLE_MS = 150;
/** The frame meter's text is rewritten at most this often (it is DOM: keep layout work rare). */
const METER_TEXT_MS = 250;

export interface ChromeApi {
  zoomTo(ns: number, px?: number, py?: number): void;
  fit(imm: boolean): void;
  panTo(ix: number, iy: number): void;
  slideTo(f: number): void;
}

export interface ChromeActions {
  onToggleLoupe(): void;
  onDiveDots(): void;
  onToggleInfo(): void;
  onToggleTelemetry(): void;
  onToggleSettings(): void;
  onPrev(): void;
  onNext(): void;
  onBack(): void;
  onCloseMenu(): void;
}

interface Props {
  iw: number;
  ih: number;
  handle: number;
  sink: DeliverySink | null;
  paintTick: number;
  gazeService: GazeSender | null;
  loupe: boolean;
  dotThreshold: number;
  maxZoom: number;
  apiRef: { current: ChromeApi | null };
  actions: ChromeActions;
  onSync(s: ViewSync): void;
  viewFeed: Feed<ViewRect | null>;
  readoutFeed: Feed<PixelReadout | null>;
}

export function ViewerChrome(props: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    v: initialView(),
    fitS: 0.1,
    iw: props.iw,
    ih: props.ih,
    mouse: null as { mx: number; my: number } | null,
    isTouch: false,
    loupeDrag: false,
    uiKey: '',
    pixelKey: '',
    /** The user placed the view; survives canvas remounts (renderer switch, context loss), not a new work. */
    userMoved: false,
    work: '',
    meter: null as FrameMeter | null,
    meterAt: -Infinity,
    drawn: 0,
    cachedTick: -1,
    cachedBrushes: [] as BrushGeom[],
    cachedRevision: -1,
  });
  const propsRef = useRef(props);
  propsRef.current = props;
  const wakeRef = useRef<() => void>(() => undefined);
  const meterRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  /** Bumped to remount the canvas: a canvas keeps its first context type (WebGL2 ↔ Canvas2D). */
  const [canvasGen, setCanvasGen] = useState(0);
  /** WebGL2 failed or lost its context for good on this viewer: Canvas2D until the switch is flipped again. */
  const gpuFailed = useRef(false);
  /** Bumped when a lost WebGL context is restored: a new renderer on the same canvas and context. */
  const [glGen, setGlGen] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cv: HTMLCanvasElement = canvas;
    const st = stateRef.current;
    const P = (): Props => propsRef.current;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let raf = 0;
    let dirty = true;
    let reportedGazeHandle = 0;
    let drawnRevision = -1;
    let lastMotion = -Infinity;
    let motionShown = false;
    st.uiKey = '';
    st.pixelKey = '';
    wakeRef.current = () => {
      dirty = true;
    };
    let dragging = false;
    let last = { x: 0, y: 0, t: 0 };
    let vel = { x: 0, y: 0 };
    const ptrs = new Map<number, { x: number; y: number }>();
    let pinch: { x: number; y: number; d: number } | null = null;
    const work = `${props.iw}x${props.ih}#${props.handle}`;
    if (st.work !== work) {
      st.work = work;
      st.userMoved = false;
    }
    const wantGpu = flags.gpu && !gpuFailed.current;
    const created = createRenderer(cv, wantGpu, {
      onVramFailure: () => P().sink?.reportVramFailure(),
    });
    if (!created) {
      gpuFailed.current = true;
      setCanvasGen((g) => g + 1);
      return;
    }
    const renderer = created;
    if (wantGpu && renderer.kind !== 'webgl2') gpuFailed.current = true; // no WebGL2 here

    const th = (): number => (P().dotThreshold) / 100;
    const maxS = (): number => P().maxZoom;
    const minS = (): number => st.fitS * MIN_ZOOM_FIT_RATIO;

    function resize(): void {
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      renderer.resize(W, H, dpr);
      if (!st.userMoved) doFit(true);
      dirty = true;
      st.uiKey = '';
    }

    function doFit(imm: boolean): void {
      const p = P();
      if (imm) {
        const r = applyFitImmediate(st.v, W, H, p.iw, p.ih);
        st.v = r.next;
        st.fitS = r.fitS;
      } else {
        const r = fitTarget(st.v, W, H, p.iw, p.ih);
        st.v = r.next;
        st.fitS = r.fitS;
      }
      st.userMoved = false;
      dirty = true;
    }

    function zoomTo(ns: number, px?: number, py?: number): void {
      const v = st.v;
      st.v = zoomTarget(v, ns, px ?? W / 2, py ?? H / 2, minS(), maxS());
      st.userMoved = true;
      dirty = true;
    }

    P().apiRef.current = {
      zoomTo,
      fit: (imm: boolean) => doFit(imm),
      panTo: (ix: number, iy: number) => {
        const v = st.v;
        st.v = { ...v, ttx: W / 2 - ix * v.ts, tty: H / 2 - iy * v.ts };
        st.userMoved = true;
        dirty = true;
      },
      slideTo: (f: number) => {
        const lo = Math.log(minS());
        const hi = Math.log(maxS());
        zoomTo(Math.exp(lo + clamp(f, 0, 1) * (hi - lo)));
      },
    };

    function brushes(): BrushGeom[] {
      const p = P();
      const sink = p.sink;
      if (!sink) return [];
      if (st.cachedTick === p.paintTick && st.cachedRevision === sink.revision) {
        return st.cachedBrushes;
      }
      const out = collectBrushes(sink.book.byDelivery.values(), p.iw, p.ih);
      st.cachedTick = p.paintTick;
      st.cachedRevision = sink.revision;
      st.cachedBrushes = out;
      return out;
    }


    function draw(): void {
      const p = P();
      const v = st.v;
      const showLoupe = p.loupe && st.mouse !== null && (!dragging || st.loupeDrag);
      const loupe = showLoupe && st.mouse
        ? { mx: st.mouse.mx, my: st.mouse.my, L: Math.min(v.s * LOUPE_MAGNIFICATION, maxS() * LOUPE_MAGNIFICATION) }
        : null;
      st.drawn = renderer.render({
        W, H, dpr, tx: v.tx, ty: v.ty, s: v.s, iw: p.iw, ih: p.ih,
        brushes: brushes(), dotThreshold: th(), loupe, flags,
      });
      placeBadge(loupe);
    }

    /** The loupe's `×4 · N%` pill: DOM over the canvas (both renderers), moved by transform only. */
    function placeBadge(loupe: { mx: number; my: number; L: number } | null): void {
      const el = badgeRef.current;
      if (!el) return;
      el.hidden = loupe === null;
      if (!loupe) return;
      const pct = Math.round(loupe.L * 100);
      const text = `×${LOUPE_MAGNIFICATION} · ${pct < 1000 ? pct : pct.toLocaleString('en-US')}%`;
      if (el.textContent !== text) el.textContent = text;
      const R = LOUPE_RADIUS;
      const by = loupe.my + R + 40 > H ? loupe.my - R - LOUPE_BADGE_HEIGHT - LOUPE_BADGE_OFFSET_Y : loupe.my + R + LOUPE_BADGE_OFFSET_Y;
      el.style.transform = `translate(${loupe.mx}px, ${by}px) translateX(-50%)`;
    }

    /** Pixel under the pointer: re-sampled only when the pixel or the paint changes. */
    function syncReadout(): void {
      const p = P();
      const v = st.v;
      let out: PixelReadout | null = null;
      if (st.mouse) {
        const ix = Math.floor((st.mouse.mx - v.tx) / v.s);
        const iy = Math.floor((st.mouse.my - v.ty) / v.s);
        if (ix >= 0 && iy >= 0 && ix < p.iw && iy < p.ih) {
          const key = ix + ',' + iy + '|' + (p.sink?.revision ?? -1);
          if (key === st.pixelKey) return;
          st.pixelKey = key;
          out = { x: ix.toLocaleString('en-US'), y: iy.toLocaleString('en-US'), hex: samplePixelHex(brushes(), ix, iy) };
        }
      }
      if (!out) st.pixelKey = '';
      p.readoutFeed.set(out);
    }

    /**
     * Frame-rate state goes to feeds (minimap, pill); the page re-renders only when what it
     * shows (zoom %, slider, dots) changes.
     */
    function syncUI(): void {
      const p = P();
      const v = st.v;
      p.viewFeed.set({ s: v.s, tx: v.tx, ty: v.ty, w: W, h: H });
      syncReadout();
      const frac = logFrac(v.s, minS(), maxS());
      const pct = v.s * 100;
      const inDots = v.s >= th();
      const key = pct.toFixed(2) + '|' + frac.toFixed(4) + '|' + inDots;
      if (key !== st.uiKey) {
        st.uiKey = key;
        p.onSync({ s: v.s, tx: v.tx, ty: v.ty, pct, frac, fitPct: st.fitS * 100, inDots, w: W, h: H });
      }
    }

    /** Glass backdrop blur re-blurs a changing canvas every frame: drop it while the view moves. */
    function markMotion(now: number, moving: boolean): void {
      if (moving || dragging || pinch) lastMotion = now;
      const motion = !flags.blurWhileMoving && now - lastMotion < MOTION_SETTLE_MS;
      if (motion === motionShown) return;
      motionShown = motion;
      cv.parentElement?.toggleAttribute('data-moving', motion);
    }

    function reportGaze(): void {
      const p = P();
      if (!p.gazeService) return;
      const v = st.v;
      const roi = viewToRoi(v.s, v.tx, v.ty, { vw: W, vh: H }, p.iw, p.ih);
      p.gazeService.motion({ handle: p.handle, x0: roi.x0, y0: roi.y0, x1: roi.x1, y1: roi.y1, vw: Math.round(W), vh: Math.round(H), flags: 0 });
      p.sink?.setView(roi.x0, roi.y0, roi.x1, roi.y1, Math.round(W), Math.round(H), p.gazeService.lastSeq); // evicts what we moved away from
    }

    function loop(): void {
      raf = requestAnimationFrame(loop);
      const p = P();
      const v = st.v;
      if (p.loupe && !st.mouse && W > 0 && H > 0) {
        st.mouse = { mx: W / 2, my: H / 2 };
        dirty = true;
      }
      const { next, moving } = tickView(v);
      st.v = next;
      const now = performance.now();
      markMotion(now, moving);
      p.sink?.checkExpiry(now); // spec 5.2.2: nothing expired is painted; a removal bumps the revision
      const revision = p.sink?.revision ?? -1;
      if (renderer.needsFrame?.()) dirty = true; // uploads still landing
      if (revision !== drawnRevision) {
        drawnRevision = revision; // new paint repaints without waiting for React's paintTick
        dirty = true;
      }
      const initialGaze = p.handle > 0 && p.handle !== reportedGazeHandle && W > 0 && H > 0;
      if (initialGaze) {
        reportedGazeHandle = p.handle;
        reportGaze();
      }
      const hasPaint = brushes().length > 0;
      if (!hasPaint) {
        renderer.renderLoader({ W, H, dpr, tx: st.v.tx, ty: st.v.ty, t: performance.now() / 1000, flags });
        if (moving || dirty || initialGaze) {
          dirty = false;
          syncUI();
          if (moving) reportGaze();
        }
        return;
      }
      if (moving || dirty || initialGaze) {
        dirty = false;
        draw();
        if (flags.fps) meterFrame(now);
        syncUI();
        if (moving) reportGaze();
      }
    }

    function meterFrame(now: number): void {
      const meter = (st.meter ??= new FrameMeter());
      meter.frame(now, performance.now() - now);
      if (now - st.meterAt < METER_TEXT_MS) return;
      st.meterAt = now;
      meterText();
    }

    /** The readout, placeholders included: shown from the moment the meter is on, before the first paint. */
    function meterText(): void {
      const el = meterRef.current;
      if (el) el.textContent = (st.meter ??= new FrameMeter()).label(st.drawn, brushes().length, renderer.kind);
    }

    /** Settings changed: repaint now, and show or hide the meter. */
    function onFlags(): void {
      if (!flags.gpu) gpuFailed.current = false; // switching off, then on again, retries WebGL2
      if ((flags.gpu && !gpuFailed.current) !== wantGpu) {
        setCanvasGen((g) => g + 1); // renderer change: a canvas keeps its first context type
        return;
      }
      dirty = true;
      st.meterAt = -Infinity;
      if (meterRef.current) meterRef.current.hidden = !flags.fps;
      if (flags.fps) meterText();
      cv.parentElement?.toggleAttribute('data-meter', flags.fps); // overlays below make room
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomTo(wheelZoom(st.v.ts, e.deltaY, e.deltaMode, e.ctrlKey), e.clientX - r.left, e.clientY - r.top);
    }

    function pinchInfo(): { x: number; y: number; d: number } {
      const [a, b] = [...ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }

    function onDown(e: PointerEvent): void {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (ptrs.size === 1) {
        if (P().loupe && e.pointerType === 'touch') {
          st.mouse = { mx, my };
          st.isTouch = true;
          st.loupeDrag = true;
          dragging = false;
        } else {
          dragging = true;
          last = { x: e.clientX, y: e.clientY, t: performance.now() };
          vel = { x: 0, y: 0 };
        }
      } else if (ptrs.size === 2) {
        st.loupeDrag = false;
        pinch = pinchInfo();
      }
      P().actions.onCloseMenu();
      dirty = true;
    }

    function onMove(e: PointerEvent): void {
      const r = cv.getBoundingClientRect();
      const v = st.v;
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      if (e.pointerType !== 'touch') {
        st.mouse = { mx, my };
        st.isTouch = false;
      }
      if (ptrs.has(e.pointerId)) {
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptrs.size >= 2 && pinch) {
          const q = pinchInfo();
          zoomTo(v.ts * (q.d / pinch.d), q.x - r.left, q.y - r.top);
          st.v = { ...st.v, s: st.v.ts, tx: st.v.ttx + (q.x - pinch.x), ty: st.v.tty + (q.y - pinch.y), ttx: st.v.ttx + (q.x - pinch.x), tty: st.v.tty + (q.y - pinch.y) };
          pinch = q;
        } else if (st.loupeDrag && P().loupe) {
          st.mouse = { mx, my };
          st.isTouch = true;
        } else if (dragging) {
          const now = performance.now();
          const dt = Math.max(1, now - last.t);
          const dx = e.clientX - last.x;
          const dy = e.clientY - last.y;
          vel = {
            x: VELOCITY_EMA_ALPHA * dx / dt + VELOCITY_EMA_BETA * vel.x,
            y: VELOCITY_EMA_ALPHA * dy / dt + VELOCITY_EMA_BETA * vel.y,
          };
          st.v = panBy(v, dx, dy);
          last = { x: e.clientX, y: e.clientY, t: now };
          st.userMoved = true;
        }
      }
      dirty = true;
    }

    function onUp(e: PointerEvent): void {
      ptrs.delete(e.pointerId);
      if (e.pointerType === 'touch' && P().loupe) {
        const r = cv.getBoundingClientRect();
        st.mouse = { mx: e.clientX - r.left, my: e.clientY - r.top };
      }
      if (ptrs.size === 0) {
        st.loupeDrag = false;
        if (dragging) {
          dragging = false;
          if (performance.now() - last.t < FLING_WINDOW_MS) st.v = flingTarget(st.v, vel.x, vel.y);
        }
      } else if (ptrs.size === 1) {
        const [q] = [...ptrs.values()];
        if (q) last = { x: q.x, y: q.y, t: performance.now() };
        vel = { x: 0, y: 0 };
        pinch = null;
      }
      dirty = true;
    }

    function onLeave(): void {
      if (!dragging && !st.isTouch) {
        st.mouse = null;
        dirty = true;
      }
    }

    function onDbl(e: MouseEvent): void {
      const r = cv.getBoundingClientRect();
      zoomTo(st.v.ts * (e.shiftKey ? DBLCLICK_ZOOM_OUT : DBLCLICK_ZOOM_IN), e.clientX - r.left, e.clientY - r.top);
    }

    function onKey(e: KeyboardEvent): void {
      const a = P().actions;
      const v = st.v;
      const t = e.target as HTMLElement | null;
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return;
      const k = e.key;
      let hit = true;
      if (k === '+' || k === '=') zoomTo(v.ts * ZOOM_STEP_FACTOR);
      else if (k === '-' || k === '_') zoomTo(v.ts / ZOOM_STEP_FACTOR);
      else if (k === '0') doFit(false);
      else if (k === '1') zoomTo(1);
      else if (k === 'ArrowLeft') {
        st.v = { ...v, ttx: v.ttx + KEY_PAN_STEP_PX };
        dirty = true;
      } else if (k === 'ArrowRight') {
        st.v = { ...v, ttx: v.ttx - KEY_PAN_STEP_PX };
        dirty = true;
      } else if (k === 'ArrowUp') {
        st.v = { ...v, tty: v.tty + KEY_PAN_STEP_PX };
        dirty = true;
      } else if (k === 'ArrowDown') {
        st.v = { ...v, tty: v.tty - KEY_PAN_STEP_PX };
        dirty = true;
      } else if (k === 'l' || k === 'L') a.onToggleLoupe();
      else if (k === 'p' || k === 'P') a.onDiveDots();
      else if (k === 'i' || k === 'I') a.onToggleInfo();
      else if (k === 't' || k === 'T') a.onToggleTelemetry();
      else if (k === 's' || k === 'S') a.onToggleSettings();
      else if (k === '[') a.onPrev();
      else if (k === ']') a.onNext();
      else if (k === 'Escape') a.onBack();
      else hit = false;
      if (hit) e.preventDefault();
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);
    cv.addEventListener('dblclick', onDbl);
    window.addEventListener('keydown', onKey);
    // §5.3: a lost context changes nothing in the protocol: the textures go, what is held stays
    // in the heap. On webglcontextrestored a new renderer re-uploads every held brush (nothing
    // is downloaded again). A context not back soon is given up on: Canvas2D on a fresh canvas.
    let restoreWait = 0;
    const onContextLost = (e: Event): void => {
      e.preventDefault(); // without it the context is never restored
      console.warn('viewer: WebGL context lost, waiting for it to be restored');
      restoreWait = window.setTimeout(() => {
        console.warn('viewer: WebGL context not restored, continuing with Canvas2D');
        gpuFailed.current = true;
        setCanvasGen((g) => g + 1);
      }, GL_RESTORE_WAIT_MS);
    };
    const onContextRestored = (): void => {
      window.clearTimeout(restoreWait);
      console.info('viewer: WebGL context restored, re-uploading the held brushes');
      setGlGen((g) => g + 1);
    };
    cv.addEventListener('webglcontextlost', onContextLost);
    cv.addEventListener('webglcontextrestored', onContextRestored);
    const offFlags = subscribeRenderFlags(onFlags);
    onFlags();
    resize();
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('pointerleave', onLeave);
      cv.removeEventListener('dblclick', onDbl);
      window.removeEventListener('keydown', onKey);
      offFlags();
      cv.removeEventListener('webglcontextlost', onContextLost);
      cv.removeEventListener('webglcontextrestored', onContextRestored);
      window.clearTimeout(restoreWait);
      renderer.dispose();
      cv.parentElement?.removeAttribute('data-moving');
      cv.parentElement?.removeAttribute('data-meter');
      ptrs.clear();
      wakeRef.current = () => undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.iw, props.ih, props.handle, canvasGen, glGen]);

  useEffect(() => {
    stateRef.current.iw = props.iw;
    stateRef.current.ih = props.ih;
  }, [props.iw, props.ih]);

  // New deliveries and renderer toggles must repaint even when the view is idle.
  useEffect(() => {
    wakeRef.current();
  }, [props.paintTick, props.sink, props.loupe, props.dotThreshold, props.maxZoom]);

  return (
    <>
      <canvas
        key={canvasGen}
        ref={canvasRef}
        className={`${styles.canvas} ${props.loupe ? styles.cursorCrosshair : styles.cursorGrab}`}
      />
      <div ref={meterRef} className={styles.meter} aria-live="off" hidden />
      <div ref={badgeRef} className={styles.loupeBadge} aria-hidden="true" hidden />
    </>
  );
}
