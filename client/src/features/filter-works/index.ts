import type { Filter } from '@/entities/work/store';
import styles from './chip.module.css';

export function nextFilter(current: Filter, pick: Filter): Filter {
  return pick === current ? current : pick;
}

/** Class names of a filter chip: shared layout plus the on or off look. */
export function chipClass(on: boolean): string {
  return `${styles.chip} ${on ? styles.on : styles.off}`;
}

export function clampFilter(f: string): Filter {
  return f === 'landscape' || f === 'portrait' ? f : 'all';
}
