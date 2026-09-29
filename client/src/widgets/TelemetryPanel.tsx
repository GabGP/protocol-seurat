import { useEffect, useState } from 'react';
import { Icon } from '@/shared/ui/Icon';
import { telemetrySections, type TelemetryInput } from '@/entities/telemetry/sections';
import { fmtRate } from '@/shared/lib/format-units';
import styles from './TelemetryPanel.module.css';

const REFRESH_MS = 500;
const SPARK_W = 272;
const SPARK_H = 56;

/** Live transfer telemetry for the open image: link rate, what the device holds, plan progress. */
export function TelemetryPanel({ read, onClose }: { read(): TelemetryInput; onClose(): void }): JSX.Element {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);
  const input = read();
  const now = fmtRate(input.link?.rate(input.now) ?? 0);
  return (
    <aside className={styles.panel} aria-label="Telemetry">
      <div className={styles.header}>
        <span className={styles.title}>Telemetry</span>
        <button onClick={onClose} title="Close (T)" className={`visor-btn ${styles.closeButton}`}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <Sparkline values={input.link?.history(input.now) ?? []} label={now} />
      {telemetrySections(input).map((s) => (
        <section key={s.title} className={styles.section}>
          <span className={styles.sectionTitle}>{s.title}</span>
          {s.rows.map((r) => (
            <div key={r.k} className={styles.row}>
              <span className={styles.keyLabel}>{r.k}</span>
              <span className={styles.valLabel}>{r.v}</span>
            </div>
          ))}
        </section>
      ))}
    </aside>
  );
}

function Sparkline({ values, label }: { values: number[]; label: string }): JSX.Element {
  const max = Math.max(1, ...values);
  const step = SPARK_W / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(SPARK_H - 2 - (v / max) * (SPARK_H - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <figure className={styles.spark}>
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" height={SPARK_H} role="img"
        aria-label={`Bandwidth over the last 60 seconds, now ${label}`}>
        <polyline points={points} className={styles.sparkLine} />
      </svg>
      <figcaption className={styles.sparkCaption}>
        <span>Bandwidth · last 60 s</span>
        <span className={styles.valLabel}>{label}</span>
      </figcaption>
    </figure>
  );
}
