import styles from './pill.module.css';

export function toggle(b: boolean): boolean {
  return !b;
}

/** Class name of a toggle pill: the on or off colours and corner radius. */
export function pillClass(on: boolean): string {
  return `${on ? styles.on : styles.off}`;
}
