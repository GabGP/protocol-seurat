import type { RenderFlags } from '@/shared/lib/render-flags';
import type { BrushGeom } from '@/entities/delivery';

/** Everything a renderer needs for one frame; CSS px unless noted. */
export interface FrameState {
  W: number;
  H: number;
  dpr: number;
  /** View: image px → CSS px is `t + x * s`. */
  tx: number;
  ty: number;
  s: number;
  /** Image size in image px. */
  iw: number;
  ih: number;
  /** Every drawable brush, coarse → fine (`collectBrushes`); renderers cull. */
  brushes: BrushGeom[];
  /** Zoom from which pixels become dots. */
  dotThreshold: number;
  /** Loupe centre (CSS px) and its zoom, or null when hidden. */
  loupe: { mx: number; my: number; L: number } | null;
  flags: Readonly<RenderFlags>;
}

export interface LoaderState {
  W: number;
  H: number;
  dpr: number;
  tx: number;
  ty: number;
  /** Seconds, for the animation. */
  t: number;
  flags: Readonly<RenderFlags>;
}

/** Paints the viewer canvas. One per canvas: a canvas holds a single context type. */
export interface ViewRenderer {
  readonly kind: 'canvas2d' | 'webgl2';
  /** Canvas backing store already sized to W·dpr × H·dpr. */
  resize(W: number, H: number, dpr: number): void;
  /** Paints the frame; returns how many brush draws it issued. */
  render(frame: FrameState): number;
  renderLoader(state: LoaderState): void;
  /** Work still pending (e.g. texture uploads): paint again even if the view is idle. */
  needsFrame?(): boolean;
  dispose(): void;
}
