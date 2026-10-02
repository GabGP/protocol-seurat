import { useEffect, useState } from 'react';
import type { Work } from '@/entities/work';
import { Dialog } from '@/shared/ui/Dialog';
import type { RunQueueDeps } from '../model/run-queue';
import type { IntakeSource } from '../model/types';
import { FileTab } from './FileTab';
import { IntakeRows } from './IntakeRows';
import { TextTab } from './TextTab';
import { useIntakeWorker } from './useIntakeWorker';
import styles from './AddWorkDialog.module.css';

export interface AddWorkDialogProps {
  open: boolean;
  initialTab?: IntakeSource;
  onClose: () => void;
  works: Work[];
  local: boolean;
  transfer: {
    upload: RunQueueDeps['upload'];
    importSource: RunQueueDeps['importSource'];
  };
  onOpen: (id: string) => void;
}

export function AddWorkDialog({
  open,
  initialTab = 'file',
  onClose,
  works,
  local,
  transfer,
  onOpen,
}: AddWorkDialogProps): JSX.Element | null {
  const [tab, setTab] = useState<IntakeSource>(initialTab);
  const { items, handleAdd, handleCancel, handleRemove } = useIntakeWorker({
    works,
    transfer,
  });

  useEffect(() => {
    if (open && initialTab) {
      setTab(initialTab === 'path' && !local ? 'file' : initialTab);
    }
  }, [open, initialTab, local]);

  return (
    <Dialog open={open} onClose={onClose} title="Add a work">
      <div className={styles.dialogContent}>
        <div className={styles.tabBar} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'file'}
            className={tab === 'file' ? styles.tabActive : styles.tab}
            onClick={() => setTab('file')}
          >
            File
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'link'}
            className={tab === 'link' ? styles.tabActive : styles.tab}
            onClick={() => setTab('link')}
          >
            Link
          </button>
          {local && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'path'}
              className={tab === 'path' ? styles.tabActive : styles.tab}
              onClick={() => setTab('path')}
            >
              This computer
            </button>
          )}
        </div>

        <div className={styles.tabContent}>
          {tab === 'file' && (
            <FileTab
              works={works}
              local={local}
              onSwitchToPath={() => setTab('path')}
              onAdd={handleAdd}
            />
          )}
          {tab === 'link' && (
            <TextTab source="link" works={works} onAdd={handleAdd} />
          )}
          {tab === 'path' && local && (
            <TextTab source="path" works={works} onAdd={handleAdd} />
          )}
        </div>

        <IntakeRows
          items={items}
          onCancel={handleCancel}
          onRemove={handleRemove}
          onOpen={(stem) => {
            onOpen(stem);
            onClose();
          }}
        />
      </div>
    </Dialog>
  );
}
