import styles from './Switch.module.css';

interface Props {
  label: string;
  hint?: string;
  on: boolean;
  disabled?: boolean;
  onChange(on: boolean): void;
}

/** A labelled on/off row (role="switch"): the whole row is the hit target. */
export function Switch({ label, hint, on, disabled = false, onChange }: Props): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className={styles.row}
      onClick={() => onChange(!on)}
    >
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? <span className={styles.hint}>{hint}</span> : null}
      </span>
      <span className={`${styles.track} ${on ? styles.trackOn : ''}`} aria-hidden="true">
        <span className={`${styles.thumb} ${on ? styles.thumbOn : ''}`} />
      </span>
    </button>
  );
}
