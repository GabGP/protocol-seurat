import { TILE } from '@/shared/config/protocol';
import { planesToRgba, toBitmap } from './planes-rgba';
import type { SynthRequest } from './protocol';
import { decodeBandDetails, decodeSeedPlanes } from './synth-decode';
import { liftPlanes } from './synth-lift';
import { emptyPlanes, resolveParent, retain } from './synth-parents';
import { postError, postMiss, postSuccess } from './synth-result';

self.onmessage = async (ev: MessageEvent<SynthRequest>) => {
  const t0 = performance.now();
  const req = ev.data;
  try {
    const w = req.seed ? req.seedWidth : TILE;
    const h = req.seed ? req.seedHeight : TILE;
    const px = w * h;
    const planes = emptyPlanes(px);
    if (req.seed) {
      await decodeSeedPlanes(req, planes);
    } else {
      const parent = resolveParent(req);
      if (!parent) {
        postMiss(req, t0);
        return;
      }
      liftPlanes(parent, await decodeBandDetails(req), planes);
    }
    // A planes-only decode (a gallery thumbnail, composed by its caller) needs neither the retained
    // copy nor the RGBA.
    if (!req.planesOnly) retain(req, planes);
    const rgba = req.planesOnly ? null : planesToRgba(planes.Y, planes.Co, planes.Cg, px);
    const bitmap = rgba ? await toBitmap(rgba, w, h) : null;
    postSuccess(req, t0, planes, rgba, bitmap, w, h);
  } catch (e) {
    postError(req, t0, e);
  }
};
