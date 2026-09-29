import { describe, expect, it } from 'vitest';
import { initialView, type ViewState } from '@/features/zoom-view';
import { createPointerGestures, initialPointer, type GestureHost } from '../index';

type Handler = (e: unknown) => void;

function rig(loupe = false): {
  fire(type: string, e: Partial<PointerEvent>): void;
  host: GestureHost;
  view: { v: ViewState };
  flags: { moved: number; changed: number; pressed: number; zooms: number[][] };
  detach: () => void;
  g: ReturnType<typeof createPointerGestures>;
} {
  const handlers = new Map<string, Handler>();
  const canvas = {
    addEventListener: (t: string, h: Handler) => handlers.set(t, h),
    removeEventListener: (t: string) => handlers.delete(t),
    setPointerCapture: () => undefined,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  } as unknown as HTMLCanvasElement;
  const view = { v: initialView() };
  const flags = { moved: 0, changed: 0, pressed: 0, zooms: [] as number[][] };
  const host: GestureHost = {
    canvas,
    pointer: initialPointer(),
    getView: () => view.v,
    setView: (v) => {
      view.v = v;
    },
    loupeOn: () => loupe,
    zoomTo: (ns, px, py) => flags.zooms.push([ns, px, py]),
    moved: () => void flags.moved++,
    changed: () => void flags.changed++,
    pressed: () => void flags.pressed++,
  };
  const g = createPointerGestures(host);
  const detach = g.attach();
  return { fire: (type, e) => handlers.get(type)?.({ pointerId: 1, pointerType: 'mouse', ...e }), host, view, flags, detach, g };
}

describe('pointer gestures', () => {
  it('a drag pans the view and marks it as moved by the user', () => {
    const r = rig();
    r.fire('pointerdown', { clientX: 100, clientY: 100 });
    expect(r.g.dragging).toBe(true);
    expect(r.flags.pressed).toBe(1);
    r.fire('pointermove', { clientX: 130, clientY: 90 });
    expect(r.view.v.tx).toBe(30);
    expect(r.view.v.ty).toBe(-10);
    expect(r.flags.moved).toBe(1);
    r.fire('pointerup', { clientX: 130, clientY: 90 });
    expect(r.g.dragging).toBe(false);
  });

  it('hover tracks the pointer in canvas coordinates and leaves clear it', () => {
    const r = rig();
    r.fire('pointermove', { clientX: 50, clientY: 70 });
    expect(r.host.pointer.mouse).toEqual({ mx: 40, my: 50 });
    r.fire('pointerleave', {});
    expect(r.host.pointer.mouse).toBeNull();
  });

  it('a single touch drags the loupe instead of panning when the loupe is on', () => {
    const r = rig(true);
    r.fire('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 60 });
    expect(r.g.dragging).toBe(false);
    expect(r.host.pointer).toMatchObject({ isTouch: true, loupeDrag: true, mouse: { mx: 50, my: 40 } });
    r.fire('pointermove', { pointerType: 'touch', clientX: 80, clientY: 90 });
    expect(r.host.pointer.mouse).toEqual({ mx: 70, my: 70 });
    expect(r.view.v.tx).toBe(0);
    r.fire('pointerup', { pointerType: 'touch', clientX: 80, clientY: 90 });
    expect(r.host.pointer.loupeDrag).toBe(false);
  });

  it('two pointers pinch: zoom by the distance ratio, then a single pointer resumes dragging', () => {
    const r = rig();
    r.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    r.fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 });
    expect(r.g.pinching).toBe(true);
    r.fire('pointermove', { pointerId: 2, clientX: 300, clientY: 100 });
    expect(r.flags.zooms[0]?.[0]).toBe(2);
    r.fire('pointerup', { pointerId: 2 });
    expect(r.g.pinching).toBe(false);
  });

  it('detaching stops listening', () => {
    const r = rig();
    r.detach();
    r.fire('pointerdown', { clientX: 1, clientY: 1 });
    expect(r.g.dragging).toBe(false);
  });
});
