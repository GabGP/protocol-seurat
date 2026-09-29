import { fmtBytes, fmtMs } from '@/shared/lib/format-units';
import { pending, PENDING, type TelemetryInput, type TelemetrySection } from './types';

const [HELD, DELIVERIES, IN_FLIGHT, WINDOW, MEAN, QUEUE] =
  ['Held', 'Deliveries', 'In flight', 'Receiver window', 'Mean size', 'Decode queue'] as const;
const KEYS = [HELD, DELIVERIES, IN_FLIGHT, WINDOW, MEAN, QUEUE];
const TITLE = 'Brushes';

/** Held against the effective cap; the server's grant is named too when the Settings cap narrows it. */
function heldOf(held: number, limit: number, grant: number | undefined): string {
  return grant !== undefined && limit < grant ? `${held} of ${limit} · grant ${grant}` : `${held} of ${limit}`;
}

/**
 * The loan book in brushes (the unit of max_pinceladas): what is held, the deliveries that made
 * them up, what is coming, what RECIBO.libre offers, how far decoding lags. Mean size is per brush.
 */
export function brushes({ sink, concession }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: TITLE, rows: pending(KEYS) };
  let data = 0;
  for (const r of sink.book.byDelivery.values()) data += r.bytes + (r.rgba ? r.rgba.width * r.rgba.height * 4 : 0);
  const held = sink.heldBrushes();
  return {
    title: TITLE,
    rows: [
      { k: HELD, v: heldOf(held, sink.holdLimit, concession?.maxBrushes) },
      { k: DELIVERIES, v: String(sink.book.byDelivery.size) },
      { k: IN_FLIGHT, v: String(sink.book.inFlight.size) },
      { k: WINDOW, v: `${sink.free()} free` },
      { k: MEAN, v: held > 0 ? `${fmtBytes(data / held)} (bands + bitmap)` : PENDING },
      { k: QUEUE, v: fmtMs(sink.queueDepthMs) },
    ],
  };
}
