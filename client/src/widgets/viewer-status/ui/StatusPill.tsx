import type { CSSProperties } from 'react';
import { useFeed, type Feed } from '@/shared/lib/feed';
import type { PixelReadout } from '@/entities/viewport';
import styles from './StatusPill.module.css';

/** Subscribes to the pointer readout alone: moving the mouse re-renders only this pill. */
export function LiveStatusPill({ feed }: { feed: Feed<PixelReadout | null> }): JSX.Element {
  return <StatusPill px={useFeed(feed)} />;
}

export function StatusPill({ px }: { px: PixelReadout | null }): JSX.Element {
  return (
    <div className={`glass-pill ${styles.pill}`}>
      {px ? (
        <>
          <span className={styles.coordItem}>
            <span className={styles.coordKey}>X</span>
            <span className={styles.coordVal}>{px.x}</span>
          </span>
          <span className={styles.coordItem}>
            <span className={styles.coordKey}>Y</span>
            <span className={styles.coordVal}>{px.y}</span>
          </span>
          {px.hex ? (
            <span className={styles.colorGroup}>
              <span
                className={styles.colorSwatch}
                style={{ '--swatch-color': px.hex } as CSSProperties}
              />
              <span className={styles.hexLabel}>{px.hex}</span>
            </span>
          ) : null}
        </>
      ) : (
        <span>Wheel to zoom · drag to pan · double click to dive in</span>
      )}
    </div>
  );
}
