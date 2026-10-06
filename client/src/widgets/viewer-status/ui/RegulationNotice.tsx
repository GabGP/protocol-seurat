import type { Regulation } from '@/shared/proto/messages';
import { ICON_SM } from '@/shared/config/icon';
import { Icon } from '@/shared/ui/Icon';
import styles from './RegulationNotice.module.css';

/** Shown while the server is cutting this session (REGULACION): the periphery waits, nothing is lost. */
export function RegulationNotice({ regulation }: { regulation: Regulation | null }): JSX.Element | null {
  if (regulation === null) return null;
  return (
    <div className={styles.notice} role="status">
      <Icon name="info" size={ICON_SM} />Server busy · sharpening the centre first
    </div>
  );
}
