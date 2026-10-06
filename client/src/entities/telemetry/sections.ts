import { MS_PER_S, PERCENT, SEED_STRATUM } from '@/shared/config/constants';
import { fmtBytes, fmtMs, fmtRate } from '@/shared/lib/format-units';
import { brushes } from './brushes-section';
import { eviction } from './eviction-section';
import { memory } from './memory-section';
import { pending, PENDING, type TelemetryInput, type TelemetrySection } from './types';

const THROTTLE: ReadonlyArray<readonly [number, string]> = [
  [1, 'server load'],
  [2, 'fine-detail budget'],
  [4, 'client decode queue'],
];

/** Network, then the open image and its view, then what the device holds, what eviction cost, and by level. */
export function telemetrySections(t: TelemetryInput): TelemetrySection[] {
  return [link(t), image(t), plan(t), brushes(t), memory(t), eviction(t), strata(t)].filter((s) => s.rows.length > 0);
}

function link({ now, transport, link: meter }: TelemetryInput): TelemetrySection {
  return {
    title: 'Link',
    rows: [
      { k: 'Transport', v: transport ?? PENDING },
      { k: 'Peak (10 s)', v: meter ? fmtRate(meter.peak(now)) : PENDING },
      { k: 'Session total', v: meter ? fmtBytes(meter.total) : PENDING },
    ],
  };
}

function image({ now, image: img, concession }: TelemetryInput): TelemetrySection {
  const secs = img ? Math.max(0.001, (now - img.openedAt) / MS_PER_S) : 1;
  return {
    title: 'This image',
    rows: [
      { k: 'Received', v: img ? `${fmtBytes(img.meter.total)} · ${img.deliveries} brushes` : PENDING },
      { k: 'Average rate', v: img ? fmtRate(img.meter.total / secs) : PENDING },
      { k: 'First brush after', v: img?.firstDeliveryMs == null ? PENDING : fmtMs(img.firstDeliveryMs) },
      { k: 'Finest allowed', v: concession ? `Level ${concession.minStratum}` : PENDING },
    ],
  };
}

const PLAN_KEYS = ['Plan', 'Time', 'Throttled by', 'Cancelled (view moved)'];

function plan({ now, image: img }: TelemetryInput): TelemetrySection {
  if (!img?.plan) return { title: 'Current view', rows: pending(PLAN_KEYS) };
  const p = img.plan;
  const pct = p.expected > 0 ? Math.min(PERCENT, Math.round((PERCENT * p.received) / p.expected)) : PERCENT;
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

/** Held brushes per level of the open work, empty ones included, finest first and the seed last. */
function strata({ sink }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: 'Held by level', rows: [] };
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
  return { title: 'Held by level', rows };
}
