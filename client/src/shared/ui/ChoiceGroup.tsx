import styles from './ChoiceGroup.module.css';

export interface Choice<T> {
  value: T;
  label: string;
}

interface Props<T> {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange(value: T): void;
}

/** A row of exclusive options (role="radiogroup"): the chosen one is filled. */
export function ChoiceGroup<T extends string | number>({ label, choices, value, onChange }: Props<T>): JSX.Element {
  return (
    <div className={styles.options} role="radiogroup" aria-label={label}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={c.value === value}
          className={`${styles.option} ${c.value === value ? styles.active : ''}`}
          onClick={() => onChange(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
