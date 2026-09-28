import { finishPlanes, type FinishRequest, type FinishResult } from './preview-finish';

/** Gallery thumbnails are shrunk to the card and turned to RGBA here, off the main thread. */
self.onmessage = (ev: MessageEvent<FinishRequest>): void => {
  const { id, planes, width, height, shownWidth } = ev.data;
  let out: FinishResult = { id, rgba: null, width: 0, height: 0 };
  try {
    const done = finishPlanes({ planes: planes.map((b) => new Int16Array(b)), width, height }, shownWidth);
    out = { id, rgba: done.rgba.buffer as ArrayBuffer, width: done.width, height: done.height };
  } finally {
    (self as unknown as Worker).postMessage(out, out.rgba ? [out.rgba] : []);
  }
};
