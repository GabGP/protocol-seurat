import type { ReactNode } from 'react';
import { ATTACHMENT_ICON_SIZE_PX } from '@/shared/config/dialog';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import styles from './Attachment.module.css';

export type AttachmentState = 'idle' | 'uploading' | 'processing' | 'error' | 'done';

export interface AttachmentProps {
  icon: string;
  title: string;
  description: string;
  state: AttachmentState;
  progress?: number;
  actions?: ReactNode;
  className?: string;
}

export interface AttachmentListProps {
  children: ReactNode;
  className?: string;
}

export function Attachment({
  icon,
  title,
  description,
  state,
  progress,
  actions,
  className,
}: AttachmentProps): JSX.Element {
  const isBusy = state === 'uploading' || state === 'processing';
  const isError = state === 'error';
  const isDone = state === 'done';

  const mediaCls = isError
    ? `${styles.media} ${styles.mediaError}`
    : isDone
    ? `${styles.media} ${styles.mediaDone}`
    : styles.media;

  return (
    <div role="group" aria-label={title} className={`${styles.row} ${className ?? ''}`}>
      {isBusy && <div className={styles.shimmer} aria-hidden="true" />}
      <div className={mediaCls} aria-hidden="true">
        <Icon name={isDone ? 'check' : icon} size={ATTACHMENT_ICON_SIZE_PX} />
      </div>
      <div className={styles.content}>
        <span className={styles.title} title={title}>{title}</span>
        <span className={isError ? `${styles.desc} ${styles.descError}` : styles.desc}>
          {description}
        </span>
        {isBusy && (
          <div className={styles.progressWrap}>
            <ProgressBar value={progress} />
          </div>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function AttachmentList({ children, className }: AttachmentListProps): JSX.Element {
  return <div className={`${styles.list} ${className ?? ''}`}>{children}</div>;
}
