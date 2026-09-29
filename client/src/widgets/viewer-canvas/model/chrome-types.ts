import type { Feed } from '@/shared/lib/feed';
import type { BrushGeom, DeliverySink } from '@/entities/delivery';
import type { ChromeApi, PixelReadout, ViewRect } from '@/entities/viewport';
import type { GazeSender } from '@/features/send-gaze';
import type { PointerState } from '@/features/pan-view';
import type { ShortcutActions } from '@/features/viewer-shortcuts';
import { initialView, type ViewState } from '@/features/zoom-view';
import { initialPointer } from '@/features/pan-view';
import type { FrameMeter } from './frame-meter';

/** What the page needs to know about the view (zoom %, slider, dots), only when it changes. */
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

export type ChromeActions = ShortcutActions;

export interface ChromeProps {
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

/** Survives an effect re-run (renderer switch, context loss); a new work resets `userMoved`. */
export interface ChromeState {
  v: ViewState;
  fitS: number;
  pointer: PointerState;
  uiKey: string;
  pixelKey: string;
  /** The user placed the view; survives canvas remounts, not a new work. */
  userMoved: boolean;
  work: string;
  meter: FrameMeter | null;
  meterAt: number;
  drawn: number;
  brushCache: { tick: number; revision: number; brushes: BrushGeom[] };
}

export const createChromeState = (): ChromeState => ({
  v: initialView(),
  fitS: 0.1,
  pointer: initialPointer(),
  uiKey: '',
  pixelKey: '',
  userMoved: false,
  work: '',
  meter: null,
  meterAt: -Infinity,
  drawn: 0,
  brushCache: { tick: -1, revision: -1, brushes: [] },
});

/** Canvas geometry (CSS px) and the repaint request, shared by one mounted canvas. */
export interface Frame {
  W: number;
  H: number;
  dpr: number;
  dirty: boolean;
}

export interface ChromeCtx {
  cv: HTMLCanvasElement;
  st: ChromeState;
  P(): ChromeProps;
  frame: Frame;
}
