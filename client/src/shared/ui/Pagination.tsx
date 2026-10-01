import { ICON_SM } from '@/shared/config/icon';
import { PAGINATION_SIBLINGS } from '@/shared/config/layout';
import { pageRange } from '@/shared/lib/pagination';
import { Icon } from './Icon';
import styles from './Pagination.module.css';

interface PaginationProps {
  page: number;
  count: number;
  onPage: (p: number) => void;
}

/** Pagination navigation control styled with gallery chip aesthetics. */
export function Pagination({ page, count, onPage }: PaginationProps): JSX.Element | null {
  if (count <= 1) {
    return null;
  }

  const slots = pageRange(page, count, PAGINATION_SIBLINGS);

  return (
    <nav role="navigation" aria-label="pagination" className={styles.nav}>
      <ul className={styles.list}>
        <li>
          <button
            type="button"
            className={`${styles.link} ${styles.step}`}
            disabled={page === 0}
            aria-label="Go to previous page"
            onClick={() => onPage(page - 1)}
          >
            <Icon name="chevron_left" size={ICON_SM} />
            <span className={styles.label}>Previous</span>
          </button>
        </li>
        {slots.map((slot, index) => (
          <li key={typeof slot === 'number' ? slot : `gap-${index}`}>
            {typeof slot === 'number' ? (
              <button
                type="button"
                className={slot === page ? `${styles.link} ${styles.active}` : styles.link}
                aria-current={slot === page ? 'page' : undefined}
                onClick={() => onPage(slot)}
              >
                {slot + 1}
              </button>
            ) : (
              <>
                <span aria-hidden="true" className={styles.gap}>
                  <Icon name="more_horiz" size={ICON_SM} />
                </span>
                <span className={styles.srOnly}>More pages</span>
              </>
            )}
          </li>
        ))}
        <li>
          <button
            type="button"
            className={`${styles.link} ${styles.step}`}
            disabled={page === count - 1}
            aria-label="Go to next page"
            onClick={() => onPage(page + 1)}
          >
            <span className={styles.label}>Next</span>
            <Icon name="chevron_right" size={ICON_SM} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
