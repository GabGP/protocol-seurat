let scratchMatrix: DOMMatrix | null = null;

/**
 * Scale-and-translate a pattern through one reused DOMMatrix: the original code's proven form
 * (a plain-object argument is newer API), minus a per-frame allocation.
 */
export function placePattern(p: CanvasPattern, k: number, e: number, f: number): void {
  const m = scratchMatrix ?? (scratchMatrix = new DOMMatrix());
  m.a = k;
  m.b = 0;
  m.c = 0;
  m.d = k;
  m.e = e;
  m.f = f;
  p.setTransform(m);
}
