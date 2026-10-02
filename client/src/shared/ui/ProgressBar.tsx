import type { CSSProperties } from 'react';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  value?: number;
  className?: string;
  style?: CSSProperties;
}

export function ProgressBar({ value, className, style }: ProgressBarProps): JSX.Element {
  const pct = value !== undefined ? Math.round(Math.max(0, Math.min(1, value)) * 100) : undefined;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={`${styles.track} ${className ?? ''}`}
      style={style}
    >
      <div
        className={pct === undefined ? styles.indeterminate : styles.fill}
        style={pct !== undefined ? { width: `${pct}%` } : undefined}
      />
    </div>
  );
}
