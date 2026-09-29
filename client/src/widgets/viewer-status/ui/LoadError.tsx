import styles from './LoadError.module.css';

export function LoadError({ onRetry }: { onRetry(): void }): JSX.Element {
  return (
    <div className={styles.card}>
      <span className={styles.message}>Could not load this image.</span>
      <button onClick={onRetry} className={styles.retryBtn}>Retry</button>
    </div>
  );
}
