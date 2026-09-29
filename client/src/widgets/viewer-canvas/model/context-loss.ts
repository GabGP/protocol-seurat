import { GL_RESTORE_WAIT_MS } from '@/shared/config/render';

/**
 * §5.3: a lost context changes nothing in the protocol: the textures go, what is held stays
 * in the heap. On webglcontextrestored a new renderer re-uploads every held brush (nothing
 * is downloaded again). A context not back soon is given up on: Canvas2D on a fresh canvas.
 * The returned function stops watching.
 */
export function watchContextLoss(cv: HTMLCanvasElement, onGiveUp: () => void, onRestored: () => void): () => void {
  let restoreWait = 0;
  const lost = (e: Event): void => {
    e.preventDefault(); // without it the context is never restored
    console.warn('viewer: WebGL context lost, waiting for it to be restored');
    restoreWait = window.setTimeout(() => {
      console.warn('viewer: WebGL context not restored, continuing with Canvas2D');
      onGiveUp();
    }, GL_RESTORE_WAIT_MS);
  };
  const restored = (): void => {
    window.clearTimeout(restoreWait);
    console.info('viewer: WebGL context restored, re-uploading the held brushes');
    onRestored();
  };
  cv.addEventListener('webglcontextlost', lost);
  cv.addEventListener('webglcontextrestored', restored);
  return () => {
    cv.removeEventListener('webglcontextlost', lost);
    cv.removeEventListener('webglcontextrestored', restored);
    window.clearTimeout(restoreWait);
  };
}
