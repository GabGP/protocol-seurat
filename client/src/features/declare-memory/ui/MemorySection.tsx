import { applyMemory, brushesFor, currentChoice, memoryChoices } from '../model/declare-memory';
import styles from './MemorySection.module.css';

/** Memory: what the viewer declares in SALUDO, so the server grants fewer brushes on a small device. */
export function MemorySection(): JSX.Element {
  const chosen = currentChoice();
  return (
    <section className={styles.section} aria-label="Memory">
      <span className={styles.sectionTitle}>Memory</span>
      <div className={styles.options} role="radiogroup" aria-label="Declared memory">
        {memoryChoices().map((c) => (
          <button
            key={c.label}
            type="button"
            role="radio"
            aria-checked={c.mib === chosen}
            className={`${styles.option} ${c.mib === chosen ? styles.active : ''}`}
            onClick={() => { if (c.mib !== chosen) applyMemory(c.mib); }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <span className={styles.hint}>
        {chosen === null ? 'Sized to this device.' : `The server holds up to ${brushesFor(chosen)} brushes.`}
        {' '}Changing it starts a new session.
      </span>
    </section>
  );
}
