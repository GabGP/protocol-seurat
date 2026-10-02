import type { ReactNode } from 'react';
import { Attachment, AttachmentList } from '@/shared/ui/Attachment';
import type { IntakeItem } from '../model/types';
import {
  attachmentStateOf,
  descriptionOf,
  iconForSource,
} from './intake-format';
import styles from './IntakeRows.module.css';

export interface IntakeRowsProps {
  items: IntakeItem[];
  onCancel: (key: string) => void;
  onRemove: (key: string) => void;
  onOpen: (stem: string) => void;
}

export function IntakeRows({
  items,
  onCancel,
  onRemove,
  onOpen,
}: IntakeRowsProps): JSX.Element | null {
  if (items.length === 0) return null;

  const reversed = [...items].reverse();

  const renderActions = (item: IntakeItem): ReactNode => {
    if (item.status === 'queued' || item.status === 'sending' || item.status === 'waiting') {
      return (
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={() => onCancel(item.key)}
        >
          Cancel
        </button>
      );
    }
    if (item.status === 'failed') {
      return (
        <button
          type="button"
          className={styles.removeBtn}
          onClick={() => onRemove(item.key)}
        >
          Remove
        </button>
      );
    }
    if (item.status === 'ready') {
      return (
        <div className={styles.readyActions}>
          <button
            type="button"
            className={styles.openBtn}
            onClick={() => onOpen(item.stem)}
          >
            Open
          </button>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={() => onRemove(item.key)}
          >
            Remove
          </button>
        </div>
      );
    }
    return null;
  };

  return (
    <AttachmentList className={styles.list}>
      {reversed.map((item) => {
        const { state, progress } = attachmentStateOf(item);
        return (
          <Attachment
            key={item.key}
            icon={iconForSource(item.source)}
            title={item.label}
            description={descriptionOf(item)}
            state={state}
            progress={progress}
            actions={renderActions(item)}
          />
        );
      })}
    </AttachmentList>
  );
}
