import type { DeliveryLedger } from '@/entities/delivery/store';
import type { RateMeter } from '@/shared/lib/rate-meter';
import type { Concession } from '@/shared/proto/messages';
import type { ImageTelemetry } from './image-telemetry';

export interface TelemetryRow {
  k: string;
  v: string;
}

export interface TelemetrySection {
  title: string;
  rows: TelemetryRow[];
}

/** The part of the delivery sink telemetry reads (DeliverySink satisfies it). */
export interface HeldBrushes {
  book: DeliveryLedger;
  free(): number;
  queueDepthMs: number;
}

export interface TelemetryInput {
  now: number;
  transport: string | null;
  link: RateMeter | null;
  image: ImageTelemetry | null;
  sink: HeldBrushes | null;
  concession: Concession | null;
}

const THROTTLE: ReadonlyArray<readonly [number, string]> = [
  [1, 'server load'],
  [2, 'fine-detail budget'],
  [4, 'client decode queue'],
];

export function telemetrySections(t: TelemetryInput): TelemetrySection[] {
  return [link(t), image(t), memory(t), plan(t), strata(t)].filter((s) => s.rows.length > 0);
}

function link({ now, transport, link: meter, sink }: TelemetryInput): TelemetrySection {
  const rows: TelemetryRow[] = [];
  if (transport) rows.push({ k: 'Transport', v: transport });
  if (meter) {
    rows.push({ k: 'Link peak (10 s)', v: fmtRate(meter.peak(now)) });
    rows.push({ k: 'Received this session', v: fmtBytes(meter.total) });
  }
  if (sink) rows.push({ k: 'Receiver window', v: `${sink.free()} brushes` });
  return { title: 'Link', rows };
}

function image({ now, image: img }: TelemetryInput): TelemetrySection {
  if (!img) return { title: 'This image', rows: [] };
  const secs = Math.max(0.001, (now - img.openedAt) / 1000);
  return {
    title: 'This image',
    rows: [
      { k: 'Downloaded', v: fmtBytes(img.meter.total) },
      { k: 'Brushes received', v: String(img.deliveries) },
      { k: 'Average since open', v: fmtRate(img.meter.total / secs) },
      { k: 'First brush after', v: img.firstDeliveryMs === null ? '—' : fmtMs(img.firstDeliveryMs) },
    ],
  };
}

function memory({ sink, concession }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: 'Stored on this device', rows: [] };
  let bands = 0;
  let pixels = 0;
  for (const r of sink.book.byDelivery.values()) {
    bands += r.bytes;
    if (r.rgba) pixels += r.rgba.width * r.rgba.height * 4;
  }
  const held = sink.book.byDelivery.size;
  return {
    title: 'Stored on this device',
    rows: [
      { k: 'Total in memory', v: fmtBytes(bands + pixels) },
      { k: 'Compressed bands', v: concession ? `${fmtBytes(bands)} of ${fmtBytes(concession.maxKiB * 1024)}` : fmtBytes(bands) },
      { k: 'Decoded pixels', v: fmtBytes(pixels) },
      { k: 'Brushes held', v: concession ? `${held} of ${concession.maxBrushes}` : String(held) },
      { k: 'In flight', v: String(sink.book.inFlight.size) },
      { k: 'Decode queue', v: fmtMs(sink.queueDepthMs) },
    ],
  };
}

function plan({ now, image: img }: TelemetryInput): TelemetrySection {
  const p = img?.plan;
  if (!img || !p) return { title: 'Current view', rows: [] };
  const pct = p.expected > 0 ? Math.min(100, Math.round((100 * p.received) / p.expected)) : 100;
  const reasons = THROTTLE.filter(([bit]) => (p.throttle & bit) !== 0).map(([, label]) => label);
  const rows: TelemetryRow[] = [
    { k: 'Plan', v: `#${p.seq} · ${p.received} of ${p.expected} brushes (${pct}%)` },
    p.finishedAt === null
      ? { k: 'Loading for', v: fmtMs(now - p.startedAt) }
      : { k: 'Completed in', v: fmtMs(p.finishedAt - p.startedAt) },
    { k: 'Throttled by', v: reasons.length > 0 ? reasons.join(', ') : 'nothing' },
  ];
  if (img.cancelled > 0) rows.push({ k: 'Cancelled (view moved)', v: String(img.cancelled) });
  return { title: 'Current view', rows };
}

function strata({ sink, concession }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: 'Detail by level', rows: [] };
  const by = new Map<number, { n: number; bytes: number }>();
  for (const r of sink.book.byDelivery.values()) {
    const s = by.get(r.stratum) ?? { n: 0, bytes: 0 };
    s.n += 1;
    s.bytes += r.bytes;
    by.set(r.stratum, s);
  }
  const rows = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, v]) => ({ k: s === 10 ? 'Seed' : `Level ${s} (1:${2 ** s})`, v: `${v.n} · ${fmtBytes(v.bytes)}` }));
  if (concession && rows.length > 0) {
    rows.push({ k: 'Finest allowed', v: `Level ${concession.minStratum} · ${concession.maxBands} bands` });
  }
  return { title: 'Detail by level', rows };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtRate(bytesPerS: number): string {
  const bits = bytesPerS * 8;
  const main = bits >= 1e6 ? `${(bits / 1e6).toFixed(1)} Mbit/s` : `${Math.round(bits / 1e3)} kbit/s`;
  return `${main} · ${fmtBytes(bytesPerS)}/s`;
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}
