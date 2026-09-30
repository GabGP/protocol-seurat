import type { PixelReadout } from '@/entities/viewport';
import { currentBrushes } from './brush-cache';
import type { ChromeCtx } from './chrome-types';
import { samplePixelHex } from './pixel-sample';

/** Pixel under the pointer: re-sampled only when the pixel or the paint changes. */
export function syncReadout(ctx: ChromeCtx): void {
  const { st, P } = ctx;
  const p = P();
  const v = st.v;
  const mouse = st.pointer.mouse;
  let out: PixelReadout | null = null;
  if (mouse) {
    const ix = Math.floor((mouse.mx - v.tx) / v.s);
    const iy = Math.floor((mouse.my - v.ty) / v.s);
    if (ix >= 0 && iy >= 0 && ix < p.iw && iy < p.ih) {
      const key = ix + ',' + iy + '|' + (p.sink?.revision ?? -1);
      if (key === st.pixelKey) return;
      st.pixelKey = key;
      out = { x: ix.toLocaleString('en-US'), y: iy.toLocaleString('en-US'), hex: samplePixelHex(currentBrushes(ctx), ix, iy, (d) => p.sink?.wantPlanes(d)) };
    }
  }
  if (!out) st.pixelKey = '';
  p.readoutFeed.set(out);
}
