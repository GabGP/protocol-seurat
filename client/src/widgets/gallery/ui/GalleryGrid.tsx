import { useRef, type CSSProperties } from 'react';
import type { Filter, Work } from '@/entities/work';
import { ingestBadge, workDims, workTitle, WORK_STATE } from '@/entities/work';
import { ICON_XS } from '@/shared/config/icon';
import { Icon } from '@/shared/ui/Icon';
import { Pagination } from '@/shared/ui/Pagination';
import { Thumb } from './GalleryThumb';
import styles from './GalleryGrid.module.css';

interface Props {
  items: Work[];
  total: number;
  offset: number;
  page: number;
  count: number;
  onPage: (p: number) => void;
  tags?: string[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (id: string) => void;
}

export function GalleryGrid({
  items,
  total,
  offset,
  page,
  count,
  onPage,
  tags,
  filter,
  onFilter,
  onOpen,
}: Props): JSX.Element {
  const bar = useRef<HTMLDivElement>(null);

  // Back to the top of the grid when the pager sits below the fold.
  const turn = (p: number): void => {
    onPage(p);
    const el = bar.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  const chips: Array<[Filter, string]> = [
    ['all', 'All'],
    ...(tags ?? []).map((t) => [t, t] as [Filter, string]),
    ['landscape', 'Landscape'],
    ['portrait', 'Portrait'],
  ];

  return (
    <>
      <div ref={bar} className={styles.filterBar}>
        <div className={styles.chipGroup}>
          {chips.map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => onFilter(k)}
                className={on ? styles.chipOn : 'chip-off'}
              >
                {on ? <Icon name="check" size={ICON_XS} /> : null}{label}
              </button>
            );
          })}
        </div>
        <span className={styles.counter}>{total} images</span>
      </div>
      <div className={styles.grid}>
        {items.map((w, i) => {
          const badge = ingestBadge(w);
          return (
            <div
              key={w.id}
              onClick={() => onOpen(w.id)}
              className="gallery-card"
            >
              <div
                className={`gallery-card-thumb ${styles.cardThumb}`}
                style={{ '--ratio': `${w.width} / ${w.height}` } as CSSProperties}
              >
                {badge && (
                  <span
                    className={`${styles.ingestBadge} ${
                      w.state === WORK_STATE.FAILED ? styles.badgeFailed : styles.badgeProcessing
                    }`}
                  >
                    {badge}
                  </span>
                )}
                <Thumb work={w} />
              </div>
              <div className={styles.cardMeta}>
                <span className={styles.cardTitle} title={workTitle(w, offset + i)}>{workTitle(w, offset + i)}</span>
                <span className={styles.cardDims}>{workDims(w)}</span>
              </div>
              {w.tag && (
                <div className={styles.cardTagRow}>
                  <span className={styles.cardTag}>
                    {w.tag}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.pager}>
        <Pagination page={page} count={count} onPage={turn} />
      </div>
    </>
  );
}
