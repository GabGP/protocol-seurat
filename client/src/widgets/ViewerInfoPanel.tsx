import { Icon } from '@/shared/ui/Icon';
import styles from './ViewerInfoPanel.module.css';

export interface InfoRow {
  k: string;
  v: string;
}

const KEYS = [
  { a: 'Zoom at cursor', k: 'Wheel / pinch' },
  { a: 'Pan', k: 'Drag / arrows' },
  { a: 'Dive in', k: 'Double click' },
  { a: 'Zoom in / out', k: '+ / −' },
  { a: 'Fit to screen', k: '0' },
  { a: 'Actual pixels', k: '1' },
  { a: 'Loupe', k: 'L' },
  { a: 'Pointillist pixels', k: 'P' },
  { a: 'Telemetry', k: 'T' },
  { a: 'Settings', k: 'S' },
  { a: 'Previous / next', k: '[ ]' },
  { a: 'Back to library', k: 'Esc' },
];

export function ViewerInfoPanel({ rows, onClose }: { rows: InfoRow[]; onClose(): void }): JSX.Element {
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>Details</span>
        <button onClick={onClose} className={`visor-btn ${styles.closeButton}`}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className={styles.rowsList}>
        {rows.map((r) => (
          <div key={r.k} className={styles.row}>
            <span className={styles.keyLabel}>{r.k}</span>
            <span className={styles.valLabel}>{r.v}</span>
          </div>
        ))}
      </div>
      <div className={styles.divider} />
      <div className={styles.shortcutsList}>
        <span className={styles.sectionTitle}>Shortcuts</span>
        {KEYS.map((k) => (
          <div key={k.a} className={styles.shortcutRow}>
            <span className={styles.shortcutAction}>{k.a}</span>
            <span className={styles.keyBadge}>{k.k}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
