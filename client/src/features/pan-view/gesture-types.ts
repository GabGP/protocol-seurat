import type { ViewState } from '../zoom-view';

/** Where the pointer hovers (CSS px on the canvas); outlives a canvas remount. */
export interface PointerState {
  mouse: { mx: number; my: number } | null;
  isTouch: boolean;
  /** A single touch is dragging the loupe instead of panning. */
  loupeDrag: boolean;
}

export const initialPointer = (): PointerState => ({ mouse: null, isTouch: false, loupeDrag: false });

/** What the gestures need from whoever owns the view. */
export interface GestureHost {
  canvas: HTMLCanvasElement;
  pointer: PointerState;
  getView(): ViewState;
  setView(v: ViewState): void;
  loupeOn(): boolean;
  zoomTo(ns: number, px: number, py: number): void;
  /** The user placed the view (pan or pinch). */
  moved(): void;
  /** Something changed that needs a repaint. */
  changed(): void;
  /** A press landed on the canvas: menus above it close. */
  pressed(): void;
}

export interface PointerGestures {
  readonly dragging: boolean;
  readonly pinching: boolean;
  /** Listens on the canvas; the returned function stops. */
  attach(): () => void;
}
