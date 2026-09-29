import { FLING_WINDOW_MS, VELOCITY_EMA_ALPHA, VELOCITY_EMA_BETA } from '@/shared/config/view';
import type { GestureHost, PointerGestures } from './gesture-types';
import { flingTarget, panBy } from './pan';

interface Pt {
  x: number;
  y: number;
}
interface Pinch extends Pt {
  d: number;
}

export function createPointerGestures(host: GestureHost): PointerGestures {
  const { canvas: cv, pointer: ptr } = host;
  const ptrs = new Map<number, Pt>();
  let dragging = false;
  let last = { x: 0, y: 0, t: 0 };
  let vel = { x: 0, y: 0 };
  let pinch: Pinch | null = null;

  const local = (e: PointerEvent): { mx: number; my: number; r: DOMRect } => {
    const r = cv.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top, r };
  };

  function pinchInfo(): Pinch {
    const [a, b] = [...ptrs.values()] as [Pt, Pt];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  }

  function onDown(e: PointerEvent): void {
    cv.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { mx, my } = local(e);
    if (ptrs.size === 1) {
      if (host.loupeOn() && e.pointerType === 'touch') {
        ptr.mouse = { mx, my };
        ptr.isTouch = true;
        ptr.loupeDrag = true;
        dragging = false;
      } else {
        dragging = true;
        last = { x: e.clientX, y: e.clientY, t: performance.now() };
        vel = { x: 0, y: 0 };
      }
    } else if (ptrs.size === 2) {
      ptr.loupeDrag = false;
      pinch = pinchInfo();
    }
    host.pressed();
    host.changed();
  }

  function pinchMove(p: Pinch, r: DOMRect): void {
    const q = pinchInfo();
    host.zoomTo(host.getView().ts * (q.d / p.d), q.x - r.left, q.y - r.top);
    const v = host.getView();
    const ttx = v.ttx + (q.x - p.x);
    const tty = v.tty + (q.y - p.y);
    host.setView({ ...v, s: v.ts, tx: ttx, ty: tty, ttx, tty });
    pinch = q;
  }

  function dragMove(e: PointerEvent): void {
    const now = performance.now();
    const dt = Math.max(1, now - last.t);
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    vel = {
      x: VELOCITY_EMA_ALPHA * dx / dt + VELOCITY_EMA_BETA * vel.x,
      y: VELOCITY_EMA_ALPHA * dy / dt + VELOCITY_EMA_BETA * vel.y,
    };
    host.setView(panBy(host.getView(), dx, dy));
    last = { x: e.clientX, y: e.clientY, t: now };
    host.moved();
  }

  function onMove(e: PointerEvent): void {
    const { mx, my, r } = local(e);
    if (e.pointerType !== 'touch') {
      ptr.mouse = { mx, my };
      ptr.isTouch = false;
    }
    if (ptrs.has(e.pointerId)) {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size >= 2 && pinch) {
        pinchMove(pinch, r);
      } else if (ptr.loupeDrag && host.loupeOn()) {
        ptr.mouse = { mx, my };
        ptr.isTouch = true;
      } else if (dragging) {
        dragMove(e);
      }
    }
    host.changed();
  }

  function onUp(e: PointerEvent): void {
    ptrs.delete(e.pointerId);
    if (e.pointerType === 'touch' && host.loupeOn()) {
      const { mx, my } = local(e);
      ptr.mouse = { mx, my };
    }
    if (ptrs.size === 0) {
      ptr.loupeDrag = false;
      if (dragging) {
        dragging = false;
        if (performance.now() - last.t < FLING_WINDOW_MS) host.setView(flingTarget(host.getView(), vel.x, vel.y));
      }
    } else if (ptrs.size === 1) {
      const [q] = [...ptrs.values()];
      if (q) last = { x: q.x, y: q.y, t: performance.now() };
      vel = { x: 0, y: 0 };
      pinch = null;
    }
    host.changed();
  }

  function onLeave(): void {
    if (!dragging && !ptr.isTouch) {
      ptr.mouse = null;
      host.changed();
    }
  }

  const listeners: [string, (e: PointerEvent) => void][] = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onUp],
    ['pointerleave', onLeave],
  ];
  return {
    get dragging() {
      return dragging;
    },
    get pinching() {
      return pinch !== null;
    },
    attach() {
      for (const [type, fn] of listeners) cv.addEventListener(type, fn as EventListener);
      return () => {
        for (const [type, fn] of listeners) cv.removeEventListener(type, fn as EventListener);
        ptrs.clear();
      };
    },
  };
}
