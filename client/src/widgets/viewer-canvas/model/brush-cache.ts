import { collectBrushes, type BrushGeom } from '@/entities/delivery';
import type { ChromeCtx } from './chrome-types';

/** Every drawable brush, rebuilt only when the paint tick or the book revision moved. */
export function currentBrushes({ st, P }: ChromeCtx): BrushGeom[] {
  const p = P();
  const sink = p.sink;
  if (!sink) return [];
  const c = st.brushCache;
  if (c.tick === p.paintTick && c.revision === sink.revision) return c.brushes;
  c.brushes = collectBrushes(sink.book.byDelivery.values(), p.iw, p.ih);
  c.tick = p.paintTick;
  c.revision = sink.revision;
  return c.brushes;
}
