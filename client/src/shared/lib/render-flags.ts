/**
 * Viewer render switches for A/B measuring, read once from `?render=a,b` (before the `#` route):
 * `nogrid`, `noshadow`, `nodots` switch a layer off; `nocull` draws every stratum (old overdraw);
 * `nolod` keeps coverage culling but draws fine tiles even where a coarser one is already sharp;
 * `blur` keeps the glass backdrop blur while moving; `fps` shows the frame meter.
 * Live A/B from the console: `__seuratRender.cull = false`, then move the view to repaint.
 */
export interface RenderFlags {
  grid: boolean;
  shadow: boolean;
  dots: boolean;
  cull: boolean;
  lod: boolean;
  blurWhileMoving: boolean;
  fps: boolean;
}

export function parseRenderFlags(search: string): RenderFlags {
  const raw = new URLSearchParams(search).get('render') ?? '';
  const on = new Set(raw.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  return {
    grid: !on.has('nogrid'),
    shadow: !on.has('noshadow'),
    dots: !on.has('nodots'),
    cull: !on.has('nocull'),
    lod: !on.has('nolod'),
    blurWhileMoving: on.has('blur'),
    fps: on.has('fps'),
  };
}

export const renderFlags: RenderFlags = parseRenderFlags(
  typeof location === 'undefined' ? '' : location.search,
);

if (typeof window !== 'undefined') {
  (window as unknown as { __seuratRender: RenderFlags }).__seuratRender = renderFlags;
}
