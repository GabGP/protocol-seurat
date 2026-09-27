import { useEffect, useRef } from 'react';
import { clamp } from '@/shared/lib/clamp';
import { drawPointillism } from './pointillism';
import { samplePixelHex } from './pixel-sample';
import { BrushCuller, collectBrushes, SKETCH_STRATUM, type BrushGeom } from './brush-cull';
import { ViewerSprites } from './render-sprites';
import { snapSpan, tilesCover } from './tile-cover';
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
import {
  TAU,
  BG_COLOR,
  IMAGE_SMOOTHING_THRESHOLD,
  DOT_FADE_RAMP_FACTOR,
  MAX_BACKGROUND_DIM,
  FRAME_SHADOW_PADDING,
  FRAME_SHADOW_OFFSET_Y,
  FRAME_SHADOW_MARGIN,
  LOUPE_RADIUS,
  LOUPE_MAGNIFICATION,
  LOUPE_PIXEL_OUTLINE_ZOOM,
  LOUPE_PIXEL_OUTLINE_WIDTH,
  LOUPE_RIM_WIDTH,
  LOUPE_BADGE_OFFSET_Y,
  LOUPE_BADGE_HEIGHT,
  LOUPE_BADGE_RADIUS,
  LOADER_DOT_COUNT,
  LOADER_SPEED,
  LOADER_ORBIT_RADIUS,
  LOADER_ORBIT_PULSE,
  LOADER_DOT_BASE_RADIUS,
} from '@/shared/config/render';
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
    sprites: new ViewerSprites(),
    mainCuller: new BrushCuller(),
    loupeCuller: new BrushCuller(),
    meter: null as FrameMeter | null,
    meterAt: -Infinity,
    drawn: 0,
    visible: [] as BrushGeom[],
    cachedTick: -1,
    cachedBrushes: [] as BrushGeom[],
    cachedRevision: -1,
  });
  const propsRef = useRef(props);
  propsRef.current = props;
  const wakeRef = useRef<() => void>(() => undefined);
  const meterRef = useRef<HTMLDivElement>(null);

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
    let userMoved = false;
    let ctx: CanvasRenderingContext2D | null = null;

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
      if (ctx) st.sprites.ensure(ctx, dpr);
      if (!userMoved) doFit(true);
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
      userMoved = false;
      dirty = true;
    }

    function zoomTo(ns: number, px?: number, py?: number): void {
      const v = st.v;
      st.v = zoomTarget(v, ns, px ?? W / 2, py ?? H / 2, minS(), maxS());
      userMoved = true;
      dirty = true;
    }

    P().apiRef.current = {
      zoomTo,
      fit: (imm: boolean) => doFit(imm),
      panTo: (ix: number, iy: number) => {
        const v = st.v;
        st.v = { ...v, ttx: W / 2 - ix * v.ts, tty: H / 2 - iy * v.ts };
        userMoved = true;
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


    /** `hole`: where the opaque sketch will cover the view anyway (null: paint everything). */
    function bg(hole: { x0: number; y0: number; x1: number; y1: number } | null = null): void {
      if (ctx) st.sprites.drawBackground(ctx, W, H, st.v.tx, st.v.ty, flags.grid, hole);
    }

    /** Brushes (culled, opaque), then the dot mask laid over them once dots are on. */
    function layer(tx: number, ty: number, s: number, cx0: number, cy0: number, cx1: number, cy1: number,
      culler: BrushCuller, under: string): void {
      if (!ctx) return;
      const p = P();
      const list = culler.cull(brushes(), s * dpr, p.iw, p.ih, flags.cull, flags.lod);
      if (list.length === 0) return;
      const seen = st.visible;
      seen.length = 0;
      for (const b of list) {
        const dx = tx + b.x * s;
        const dy = ty + b.y * s;
        if (dx + b.w * s < cx0 || dx > cx1 || dy + b.h * s < cy0 || dy > cy1) continue;
        seen.push(b);
      }
      // Outside dots, tiles snap to whole device px and abut exactly, so once they cover the view
      // the sketch under them (a full-view upscale) is pure overdraw. Dots keep exact placement:
      // the dot grid is locked to the unsnapped pixel grid.
      const snap = s < th();
      const skipSketch = snap && flags.cull && seen[0]?.stratum === SKETCH_STRATUM
        && tilesCover(seen, { x0: (cx0 - tx) / s, y0: (cy0 - ty) / s, x1: (cx1 - tx) / s, y1: (cy1 - ty) / s }, p.iw, p.ih);
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = s < IMAGE_SMOOTHING_THRESHOLD;
      for (const b of seen) {
        if (skipSketch && b.stratum === SKETCH_STRATUM) continue;
        if (snap) {
          const [x, w] = snapSpan(tx + b.x * s, tx + (b.x + b.w) * s, dpr);
          const [y, h] = snapSpan(ty + b.y * s, ty + (b.y + b.h) * s, dpr);
          ctx.drawImage(b.bmp, x, y, w, h);
        } else {
          ctx.drawImage(b.bmp, tx + b.x * s, ty + b.y * s, b.w * s, b.h * s);
        }
        st.drawn++;
      }
      if (flags.dots && s >= th()) { // always dots once a pixel is big enough to hold several
        const f = Math.min(1, (s - th()) / (th() * DOT_FADE_RAMP_FACTOR));
        drawPointillism(ctx, { tx, ty, s, cx0, cy0, cx1, cy1, amount: f * MAX_BACKGROUND_DIM, under });
      }
    }

    function draw(): void {
      if (!ctx) return;
      const p = P();
      const v = st.v;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const iw = p.iw * v.s;
      const ih = p.ih * v.s;
      // The sketch spans the whole image and is opaque: no background (or black) is needed under it.
      const sketched = brushes()[0]?.stratum === SKETCH_STRATUM;
      bg(sketched ? { x0: v.tx, y0: v.ty, x1: v.tx + iw, y1: v.ty + ih } : null);
      if (
        v.tx > -FRAME_SHADOW_PADDING ||
        v.ty > -FRAME_SHADOW_PADDING ||
        v.tx + iw < W + FRAME_SHADOW_PADDING ||
        v.ty + ih < H + FRAME_SHADOW_PADDING
      ) {
        const m = FRAME_SHADOW_MARGIN;
        const fx = Math.max(v.tx, -m);
        const fy = Math.max(v.ty, -m);
        const fw = Math.min(v.tx + iw, W + m) - fx;
        const fh = Math.min(v.ty + ih, H + m) - fy;
        if (flags.shadow) st.sprites.drawFrameShadow(ctx, fx, fy, fw, fh, FRAME_SHADOW_OFFSET_Y);
        if (!sketched) {
          ctx.fillStyle = '#000';
          ctx.fillRect(fx, fy, fw, fh);
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.tx, v.ty, iw, ih);
      ctx.clip();
      layer(v.tx, v.ty, v.s, 0, 0, W, H, st.mainCuller, BG_COLOR);
      ctx.restore();
      if (p.loupe && st.mouse && (!dragging || st.loupeDrag)) {
        const { mx, my } = st.mouse;
        const R = LOUPE_RADIUS;
        const L = Math.min(v.s * LOUPE_MAGNIFICATION, maxS() * LOUPE_MAGNIFICATION);
        const ix = clamp((mx - v.tx) / v.s, 0, p.iw);
        const iy = clamp((my - v.ty) / v.s, 0, p.ih);
        const ltx = mx - ix * L;
        const lty = my - iy * L;
        st.sprites.drawLoupeDisc(ctx, mx, my);
        ctx.save();
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, TAU);
        ctx.clip();
        ctx.beginPath();
        ctx.rect(ltx, lty, p.iw * L, p.ih * L);
        ctx.clip();
        layer(ltx, lty, L, mx - R, my - R, mx + R, my + R, st.loupeCuller, BG_COLOR);
        if (L >= LOUPE_PIXEL_OUTLINE_ZOOM) {
          const px = Math.floor(ix);
          const py = Math.floor(iy);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = LOUPE_PIXEL_OUTLINE_WIDTH;
          ctx.strokeRect(ltx + px * L, lty + py * L, L, L);
        }
        ctx.restore();
        ctx.lineWidth = LOUPE_RIM_WIDTH;
        ctx.strokeStyle = '#B8C4FF';
        ctx.beginPath();
        ctx.arc(mx, my, R, 0, TAU);
        ctx.stroke();

        const label = `×${LOUPE_MAGNIFICATION} · ` + (L * 100 < 1000 ? Math.round(L * 100) : Math.round(L * 100).toLocaleString('en-US')) + '%';
        ctx.font = '600 12px "Roboto Flex", system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 20;
        const by = (my + R + 40 > H) ? (my - R - LOUPE_BADGE_HEIGHT - LOUPE_BADGE_OFFSET_Y) : (my + R + LOUPE_BADGE_OFFSET_Y);
        ctx.fillStyle = '#B8C4FF';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(mx - tw / 2, by, tw, LOUPE_BADGE_HEIGHT, LOUPE_BADGE_RADIUS);
        else ctx.rect(mx - tw / 2, by, tw, LOUPE_BADGE_HEIGHT);
        ctx.fill();
        ctx.fillStyle = '#1F2D6F';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, by + LOUPE_BADGE_HEIGHT / 2);
      }
    }

    function drawLoader(): void {
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bg();
      const t = performance.now() / 1000;
      const cols = ['#B8C4FF', '#FF8A5B', '#DDE1F9', '#FFB599'];
      for (let i = 0; i < LOADER_DOT_COUNT; i++) {
        const a = t * LOADER_SPEED + i * (TAU / LOADER_DOT_COUNT);
        const R = LOADER_ORBIT_RADIUS + LOADER_ORBIT_PULSE * Math.sin(t * 3 + i);
        ctx.fillStyle = cols[i % 4] ?? '#B8C4FF';
        ctx.beginPath();
        const rDot = LOADER_DOT_BASE_RADIUS + LOADER_DOT_BASE_RADIUS * (0.5 + 0.5 * Math.sin(t * 4 - i * 0.7));
        ctx.arc(W / 2 + Math.cos(a) * R, H / 2 + Math.sin(a) * R, rDot, 0, TAU);
        ctx.fill();
      }
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
      p.sink?.setView(roi.x0, roi.y0, roi.x1, roi.y1, Math.round(W), Math.round(H)); // evicts what we moved away from
    }

    function loop(): void {
      raf = requestAnimationFrame(loop);
      if (!ctx) return;
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
      const revision = p.sink?.revision ?? -1;
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
        drawLoader();
        if (moving || dirty || initialGaze) {
          dirty = false;
          syncUI();
          if (moving) reportGaze();
        }
        return;
      }
      if (moving || dirty || initialGaze) {
        dirty = false;
        st.drawn = 0;
        draw();
        if (flags.fps) meterFrame(now);
        syncUI();
        if (moving) reportGaze();
      }
    }

    function meterFrame(now: number): void {
      const meter = (st.meter ??= new FrameMeter());
      meter.frame(now, performance.now() - now);
      const el = meterRef.current;
      if (!el || now - st.meterAt < METER_TEXT_MS) return;
      st.meterAt = now;
      el.textContent = meter.label(st.drawn, brushes().length);
    }

    /** Settings changed: repaint now, and show or hide the meter. */
    function onFlags(): void {
      dirty = true;
      st.meterAt = -Infinity;
      if (meterRef.current) meterRef.current.hidden = !flags.fps;
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
          userMoved = true;
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

    // Opaque: every frame paints the background first, and the compositor can skip blending.
    ctx = cv.getContext('2d', { alpha: false });
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
      cv.parentElement?.removeAttribute('data-moving');
      cv.parentElement?.removeAttribute('data-meter');
      ptrs.clear();
      wakeRef.current = () => undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.iw, props.ih, props.handle]);

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
        ref={canvasRef}
        className={`${styles.canvas} ${props.loupe ? styles.cursorCrosshair : styles.cursorGrab}`}
      />
      <div ref={meterRef} className={styles.meter} aria-live="off" hidden />
    </>
  );
}
