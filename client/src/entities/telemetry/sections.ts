import type { DeliveryLedger } from '@/entities/delivery/store';
import { SEED_STRATUM } from '@/shared/config/constants';
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
  /** Strata of the open work (`top + 1`): levels 0 … top − 1 arrive as brushes, the top one as the seed. */
  strata: number;
}

export interface TelemetryInput {
  now: number;
  transport: string | null;
  link: RateMeter | null;
  image: ImageTelemetry | null;
  sink: HeldBrushes | null;
  concession: Concession | null;
}

/** Stands for a value not known yet: rows keep their place so only values change as data arrives. */
export const PENDING = '—';

const THROTTLE: ReadonlyArray<readonly [number, string]> = [
  [1, 'server load'],
  [2, 'fine-detail budget'],
  [4, 'client decode queue'],
];

export function telemetrySections(t: TelemetryInput): TelemetrySection[] {
  return [link(t), image(t), memory(t), plan(t), strata(t)].filter((s) => s.rows.length > 0);
}

function link({ now, transport, link: meter, sink }: TelemetryInput): TelemetrySection {
  return {
    title: 'Link',
    rows: [
      { k: 'Transport', v: transport ?? PENDING },
      { k: 'Link peak (10 s)', v: meter ? fmtRate(meter.peak(now)) : PENDING },
      { k: 'Received this session', v: meter ? fmtBytes(meter.total) : PENDING },
      { k: 'Receiver window', v: sink ? `${sink.free()} brushes` : PENDING },
    ],
  };
}

function image({ now, image: img }: TelemetryInput): TelemetrySection {
  const secs = img ? Math.max(0.001, (now - img.openedAt) / 1000) : 1;
  return {
    title: 'This image',
    rows: [
      { k: 'Downloaded', v: img ? fmtBytes(img.meter.total) : PENDING },
      { k: 'Brushes received', v: img ? String(img.deliveries) : PENDING },
      { k: 'Average since open', v: img ? fmtRate(img.meter.total / secs) : PENDING },
      { k: 'First brush after', v: img?.firstDeliveryMs == null ? PENDING : fmtMs(img.firstDeliveryMs) },
    ],
  };
}

const MEMORY_KEYS = ['Total in memory', 'Compressed bands', 'Decoded pixels', 'Brushes held', 'In flight', 'Decode queue'];
const PLAN_KEYS = ['Plan', 'Time', 'Throttled by', 'Cancelled (view moved)'];
const pending = (keys: string[]): TelemetryRow[] => keys.map((k) => ({ k, v: PENDING }));

function memory({ sink, concession }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: 'Stored on this device', rows: pending(MEMORY_KEYS) };
  let bands = 0;
  let pixels = 0;
  for (const r of sink.book.byDelivery.values()) {
    bands += r.bytes;
    if (r.rgba) pixels += r.rgba.width * r.rgba.height * 4;
  }
  const held = sink.book.byDelivery.size;
  const values = [
    fmtBytes(bands + pixels),
    concession ? `${fmtBytes(bands)} of ${fmtBytes(concession.maxKiB * 1024)}` : fmtBytes(bands),
    fmtBytes(pixels),
    concession ? `${held} of ${concession.maxBrushes}` : String(held),
    String(sink.book.inFlight.size),
    fmtMs(sink.queueDepthMs),
  ];
  return { title: 'Stored on this device', rows: MEMORY_KEYS.map((k, i) => ({ k, v: values[i] ?? PENDING })) };
}

function plan({ now, image: img }: TelemetryInput): TelemetrySection {
  if (!img?.plan) return { title: 'Current view', rows: pending(PLAN_KEYS) };
  const p = img.plan;
  const pct = p.expected > 0 ? Math.min(100, Math.round((100 * p.received) / p.expected)) : 100;
  const reasons = THROTTLE.filter(([bit]) => (p.throttle & bit) !== 0).map(([, label]) => label);
  return {
    title: 'Current view',
    rows: [
      { k: 'Plan', v: `#${p.seq} · ${p.received} of ${p.expected} brushes (${pct}%)` },
      {
        k: 'Time',
        v: p.finishedAt === null ? `loading · ${fmtMs(now - p.startedAt)}` : `done · ${fmtMs(p.finishedAt - p.startedAt)}`,
      },
      { k: 'Throttled by', v: reasons.length > 0 ? reasons.join(', ') : 'nothing' },
      { k: 'Cancelled (view moved)', v: String(img.cancelled) },
    ],
  };
}

/** Every level of the open work, empty ones included, finest first and the seed last. */
function strata({ sink, concession }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: 'Detail by level', rows: [] };
  const top = Math.max(0, sink.strata - 1);
  const by = new Map<number, { n: number; bytes: number }>();
  for (let s = 0; s < top; s++) by.set(s, { n: 0, bytes: 0 });
  by.set(SEED_STRATUM, { n: 0, bytes: 0 });
  for (const r of sink.book.byDelivery.values()) {
    const s = by.get(r.stratum) ?? { n: 0, bytes: 0 };
    s.n += 1;
    s.bytes += r.bytes;
    by.set(r.stratum, s);
  }
  const rows = [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, v]) => ({
      k: s === SEED_STRATUM ? 'Seed' : `Level ${s} (1:${2 ** s})`,
      v: `${v.n} · ${fmtBytes(v.bytes)}`,
    }));
  rows.push({
    k: 'Finest allowed',
    v: concession ? `Level ${concession.minStratum} · ${concession.maxBands} bands` : PENDING,
  });
  return { title: 'Detail by level', rows };
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const RATE_UNITS = ['kbit/s', 'Mbit/s', 'Gbit/s'] as const;
const KIBI = 1024;
const KILO = 1000;
/** A value is shown in the next unit up once it would need a fourth integer digit. */
const UNIT_CEIL = 1000;

/** Three significant digits (5.70, 79.7, 340), so values keep one width as they change. */
function sig3(v: number): string {
  const r = Number(v.toPrecision(3));
  return r === 0 ? '0' : r.toFixed(r < 10 ? 2 : r < 100 ? 1 : 0);
}

function scaled(v: number, base: number, units: readonly string[], wholeFirst: boolean): string {
  let u = 0;
  while (u < units.length - 1 && Number(v.toPrecision(3)) >= UNIT_CEIL) {
    v /= base;
    u += 1;
  }
  return `${u === 0 && wholeFirst ? Math.round(v) : sig3(v)} ${units[u]}`;
}

export function fmtBytes(n: number): string {
  return scaled(n, KIBI, BYTE_UNITS, true);
}

export function fmtRate(bytesPerS: number): string {
  return `${scaled((bytesPerS * 8) / KILO, KILO, RATE_UNITS, false)} · ${fmtBytes(bytesPerS)}/s`;
}

export function fmtMs(ms: number): string {
  return ms >= KILO ? `${sig3(ms / KILO)} s` : `${Math.round(ms)} ms`;
}
