import { GL_LOADER_RGB } from './gl-colors';
import type { GLPrimitives } from './gl-primitives';
import type { GLResources } from './gl-resources';
import { forEachLoaderDot } from './loader-dots';
import type { LoaderState } from './view-renderer';

/** The loading animation: the background with the orbiting dots, before any brush has landed. */
export function drawLoader(r: GLResources, prims: GLPrimitives, l: LoaderState): void {
  prims.background(l.tx, l.ty, l.flags.grid);
  forEachLoaderDot(l.t, r.W, r.H, (i, x, y, radius) => {
    const c = GL_LOADER_RGB[i % GL_LOADER_RGB.length] ?? [1, 1, 1];
    prims.discShape(x, y, radius, 0, 0, [c[0], c[1], c[2], 1]);
  });
}
