import { DBLCLICK_ZOOM_IN, DBLCLICK_ZOOM_OUT } from '@/shared/config/view';
import { wheelZoom } from './zoom';

export interface ZoomGestureHost {
  canvas: HTMLCanvasElement;
  /** Target scale of the view (the value a zoom multiplies). */
  scale(): number;
  zoomTo(ns: number, px: number, py: number): void;
}

/** Wheel / trackpad pinch and double click zoom about the pointer. The returned function stops. */
export function attachZoomGestures(host: ZoomGestureHost): () => void {
  const cv = host.canvas;
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    host.zoomTo(wheelZoom(host.scale(), e.deltaY, e.deltaMode, e.ctrlKey), e.clientX - r.left, e.clientY - r.top);
  };
  const onDbl = (e: MouseEvent): void => {
    const r = cv.getBoundingClientRect();
    host.zoomTo(host.scale() * (e.shiftKey ? DBLCLICK_ZOOM_OUT : DBLCLICK_ZOOM_IN), e.clientX - r.left, e.clientY - r.top);
  };
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', onDbl);
  return () => {
    cv.removeEventListener('wheel', onWheel);
    cv.removeEventListener('dblclick', onDbl);
  };
}
