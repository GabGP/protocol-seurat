import { zoomTarget } from '../zoom-view';
import type { ViewState } from '../zoom-view';

export function oneToOne(v: ViewState, w: number, h: number): ViewState {
  return zoomTarget(v, 1, w / 2, h / 2, 1e-6, 1e9);
}
