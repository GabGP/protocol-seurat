import { useSyncExternalStore } from 'react';
import { autoBrushCap, capChoice, onBrushCap, setBrushCap } from '@/entities/delivery';
import { ChoiceGroup } from '@/shared/ui/ChoiceGroup';
import { capChoices } from '../model/cap-choices';
import styles from './CapSection.module.css';

interface Props {
  /** Brushes the server grants this browser. */
  grant: number;
}

/** Max brushes: how many this viewer keeps at once; changing it applies at once, no reload. */
export function CapSection({ grant }: Props): JSX.Element {
  const chosen = useSyncExternalStore(onBrushCap, capChoice);
  const auto = useSyncExternalStore(onBrushCap, autoBrushCap);
  const choices = capChoices(grant, auto).map((c) => ({ value: c.cap, label: c.label }));
  return (
    <section className={styles.section} aria-label="Max brushes">
      <span className={styles.sectionTitle}>Max brushes</span>
      <ChoiceGroup label="Max brushes" choices={choices} value={chosen} onChange={setBrushCap} />
      <span className={styles.hint}>This browser allows up to {grant} brushes.</span>
    </section>
  );
}
