import { collectBrushes, type BrushGeom } from '@/entities/delivery';
import type { ChromeCtx } from './chrome-types';

/** Every drawable brush, rebuilt only when the paint tick or the book revision moved. */
export function currentBrushes({ st, P }: ChromeCtx): BrushGeom[] {
  const p = P();
  const sink = p.sink;
  const c = st.brushCache;
  if (!sink) {
    // A retired sink's bitmaps are closed: the cache must not keep their brush list (nor the ImageBitmaps) alive.
    if (c.brushes.length > 0) c.brushes = [];
    c.revision = -1;
    return c.brushes;
  }
  if (c.tick === p.paintTick && c.revision === sink.revision) return c.brushes;
  c.brushes = collectBrushes(sink.book.byDelivery.values(), p.iw, p.ih);
  c.tick = p.paintTick;
  c.revision = sink.revision;
  return c.brushes;
}
