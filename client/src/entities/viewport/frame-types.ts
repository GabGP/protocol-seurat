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

/** What the canvas offers the chrome around it (toolbar, minimap): imperative view moves. */
export interface ChromeApi {
  zoomTo(ns: number, px?: number, py?: number): void;
  fit(imm: boolean): void;
  panTo(ix: number, iy: number): void;
  slideTo(f: number): void;
}

export const sameViewRect = (a: ViewRect | null, b: ViewRect | null): boolean =>
  a === b || (!!a && !!b && a.s === b.s && a.tx === b.tx && a.ty === b.ty && a.w === b.w && a.h === b.h);

export const sameReadout = (a: PixelReadout | null, b: PixelReadout | null): boolean =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.hex === b.hex);
