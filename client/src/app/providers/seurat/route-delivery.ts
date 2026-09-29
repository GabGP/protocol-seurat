import type { SessionEvents } from '@/entities/session';
import { parseBrushHead, splitBrushId } from '@/shared/proto/brush';
import { LEASE_S } from '@/shared/config/constants';
import type { Runtime } from './runtime';

type DeliveryEvents = Pick<SessionEvents, 'onDelivery' | 'onIncoming'>;

/** Note a delivery for a handle nobody here is painting, so a later RASPAR/AUDITAR can be answered for it. */
function recordForRetired(rt: Runtime, bytes: Uint8Array): void {
  try {
    const h = parseBrushHead(bytes);
    if (rt.telemetry?.handle === h.handle) rt.telemetry.onDelivery(bytes.length, h.delivery, performance.now());
    if (rt.sink?.handle === h.handle || rt.preview?.owns(h.handle)) return;
    let bandBytes = 0;
    for (const n of h.lengths) bandBytes += n;
    rt.ledgers.record(h.handle, {
      delivery: h.delivery,
      brushId: h.brushId,
      stratum: splitBrushId(h.brushId).stratum,
      from: h.from,
      through: h.through,
      bytes: bandBytes,
      epoch: h.epoch,
      edition: h.edition,
      expires: 0,
      rgba: null,
    });
  } catch {
    /* unparseable frame: sink/preview paths reject it too */
  }
}

export function deliveryEvents(rt: Runtime): DeliveryEvents {
  return {
    onDelivery: (bytes) => {
      recordForRetired(rt, bytes);
      if (rt.preview?.onDelivery(bytes)) return;
      rt.sink?.ingest(bytes, () => performance.now(), () => {
        if (rt.alive) rt.bumpPaint();
      }, rt.concession?.leaseS ?? LEASE_S);
    },
    onIncoming: () => {
      const now = performance.now();
      rt.sink?.checkExpiry(now);
      rt.preview?.sweep(now);
    },
  };
}
