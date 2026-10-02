import { useState } from 'react';
import type { Work } from '@/entities/work';
import { ICON_SM } from '@/shared/config/icon';
import { Icon } from '@/shared/ui/Icon';
import { Popover, PopoverItem } from '@/shared/ui/Popover';
import type { RunQueueDeps } from '../model/run-queue';
import type { IntakeSource } from '../model/types';
import { AddWorkDialog } from './AddWorkDialog';
import styles from './AddWorkButton.module.css';

export interface AddWorkButtonProps {
  works: Work[];
  local: boolean;
  transfer: {
    upload: RunQueueDeps['upload'];
    importSource: RunQueueDeps['importSource'];
  };
  onOpen: (id: string) => void;
}

export function AddWorkButton({
  works,
  local,
  transfer,
  onOpen,
}: AddWorkButtonProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<IntakeSource>('file');

  const handleSelect = (tab: IntakeSource) => {
    setActiveTab(tab);
    setDialogOpen(true);
    setMenuOpen(false);
  };

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.button}
        onClick={() => setMenuOpen((open) => !open)}
        aria-label="Add"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Icon name="add" size={ICON_SM} />
        <span>Add</span>
      </button>

      <Popover open={menuOpen} onClose={() => setMenuOpen(false)}>
        <PopoverItem
          icon="upload"
          label="Upload file"
          onSelect={() => handleSelect('file')}
        />
        <PopoverItem
          icon="link"
          label="From link"
          onSelect={() => handleSelect('link')}
        />
        {local && (
          <PopoverItem
            icon="computer"
            label="From this computer"
            onSelect={() => handleSelect('path')}
          />
        )}
      </Popover>

      <AddWorkDialog
        open={dialogOpen}
        initialTab={activeTab}
        onClose={() => setDialogOpen(false)}
        works={works}
        local={local}
        transfer={transfer}
        onOpen={onOpen}
      />
    </div>
  );
}
