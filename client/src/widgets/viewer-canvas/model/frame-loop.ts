import type { PointerGestures } from '@/features/pan-view';
import { tickView } from '@/features/zoom-view';
import { MS_PER_S } from '@/shared/config/units';
import { renderFlags as flags } from '@/shared/lib/render-flags';
import { currentBrushes } from './brush-cache';
import type { ChromeCtx } from './chrome-types';
import { reportGaze, syncUI } from './frame-sync';
import { loupeAt, placeBadge } from './loupe-badge';
import type { MeterView } from './meter-view';
import type { ViewController } from './view-controller';
import type { ViewRenderer } from './view-renderer';

/** Glass blur stays off this long after motion ends (no flicker between gesture frames). */
const MOTION_SETTLE_MS = 150;

export interface FrameLoopDeps {
  renderer: ViewRenderer;
  vc: ViewController;
  gestures: PointerGestures;
  meter: MeterView;
  badge(): HTMLElement | null;
}

export interface FrameLoop {
  start(): void;
  stop(): void;
}

/** One requestAnimationFrame loop: eases the view, repaints when something changed, feeds the UI. */
export function createFrameLoop(ctx: ChromeCtx, d: FrameLoopDeps): FrameLoop {
  const { cv, st, P, frame } = ctx;
  const { renderer, vc, gestures } = d;
  let raf = 0;
  let reportedGazeHandle = 0;
  let drawnRevision = -1;
  let lastMotion = -Infinity;
  let motionShown = false;

  function draw(): void {
    const p = P();
    const v = st.v;
    const loupe = loupeAt(p.loupe, st.pointer, gestures.dragging, v.s, vc.maxS());
    renderer.render({
      W: frame.W, H: frame.H, dpr: frame.dpr, tx: v.tx, ty: v.ty, s: v.s, iw: p.iw, ih: p.ih,
      brushes: currentBrushes(ctx), dotThreshold: vc.th(), loupe, flags,
    });
    placeBadge(d.badge(), loupe, frame.H);
  }

  /** Glass backdrop blur re-blurs a changing canvas every frame: drop it while the view moves. */
  function markMotion(now: number, moving: boolean): void {
    if (moving || gestures.dragging || gestures.pinching) lastMotion = now;
    const motion = !flags.blurWhileMoving && now - lastMotion < MOTION_SETTLE_MS;
    if (motion === motionShown) return;
    motionShown = motion;
    cv.parentElement?.toggleAttribute('data-moving', motion);
  }

  function loop(): void {
    raf = requestAnimationFrame(loop);
    const p = P();
    if (p.loupe && !st.pointer.mouse && frame.W > 0 && frame.H > 0) {
      st.pointer.mouse = { mx: frame.W / 2, my: frame.H / 2 };
      frame.dirty = true;
    }
    const { next, moving } = tickView(st.v);
    st.v = next;
    const now = performance.now();
    markMotion(now, moving);
    p.sink?.checkExpiry(now); // spec 5.2.2: nothing expired is painted; a removal bumps the revision
    const revision = p.sink?.revision ?? -1;
    if (renderer.needsFrame?.()) frame.dirty = true; // uploads still landing
    if (revision !== drawnRevision) {
      drawnRevision = revision; // new paint repaints without waiting for React's paintTick
      frame.dirty = true;
    }
    const initialGaze = p.handle > 0 && p.handle !== reportedGazeHandle && frame.W > 0 && frame.H > 0;
    if (initialGaze) {
      reportedGazeHandle = p.handle;
      reportGaze(ctx);
    }
    const hasPaint = currentBrushes(ctx).length > 0;
    if (!hasPaint) {
      renderer.renderLoader({ W: frame.W, H: frame.H, dpr: frame.dpr, tx: st.v.tx, ty: st.v.ty, t: performance.now() / MS_PER_S, flags });
    }
    if (moving || frame.dirty || initialGaze) {
      frame.dirty = false;
      if (hasPaint) {
        draw();
        if (flags.fps) d.meter.frame(now);
      }
      syncUI(ctx, vc);
      if (moving) reportGaze(ctx);
    }
  }

  return {
    start() {
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      cv.parentElement?.removeAttribute('data-moving');
    },
  };
}
