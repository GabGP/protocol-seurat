import { finishRegion, type FinishRequest, type FinishResult } from './preview-finish';

/** The changed part of a gallery thumbnail is shrunk to the card and turned to RGBA here, off the main thread. */
self.onmessage = (ev: MessageEvent<FinishRequest>): void => {
  const { id, planes } = ev.data;
  let out: FinishResult = { id, rgba: null };
  try {
    out = { id, rgba: finishRegion(ev.data, planes.map((b) => new Int16Array(b))).buffer as ArrayBuffer };
  } finally {
    (self as unknown as Worker).postMessage(out, out.rgba ? [out.rgba] : []);
  }
};
