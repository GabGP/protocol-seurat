import { Canvas2DRenderer } from './canvas2d-renderer';
import { WebGL2Renderer, type GLHooks } from './gl-renderer';
import type { ViewRenderer } from './view-renderer';

/**
 * WebGL2 when wanted and available, else Canvas2D. Null means WebGL2 took the canvas and then
 * failed (a canvas keeps its first context type): the caller must retry on a fresh canvas with
 * `gpu` off.
 */
export function createRenderer(canvas: HTMLCanvasElement, gpu: boolean, hooks: GLHooks): ViewRenderer | null {
  if (gpu) {
    try {
      return new WebGL2Renderer(canvas, hooks);
    } catch (e) {
      console.warn('viewer: WebGL2 renderer unavailable, using Canvas2D', e);
    }
  }
  try {
    return new Canvas2DRenderer(canvas);
  } catch {
    return null;
  }
}
