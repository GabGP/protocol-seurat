import { useSyncExternalStore } from 'react';
import { brushCap, onBrushCap, setBrushCap } from '@/entities/delivery';
import { capChoices } from '../model/cap-choices';
import styles from './CapSection.module.css';

interface Props {
  /** Brushes the server grants this browser. */
  grant: number;
}

/** Max brushes: how many this viewer keeps at once; changing it applies at once, no reload. */
export function CapSection({ grant }: Props): JSX.Element {
  const chosen = useSyncExternalStore(onBrushCap, brushCap);
  return (
    <section className={styles.section} aria-label="Max brushes">
      <span className={styles.sectionTitle}>Max brushes</span>
      <div className={styles.options} role="radiogroup" aria-label="Max brushes">
        {capChoices(grant).map((c) => (
          <button
            key={c.cap}
            type="button"
            role="radio"
            aria-checked={c.cap === chosen}
            className={`${styles.option} ${c.cap === chosen ? styles.active : ''}`}
            onClick={() => setBrushCap(c.cap)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <span className={styles.hint}>This browser allows up to {grant} brushes.</span>
    </section>
  );
}
