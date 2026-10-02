import type { Work } from '@/entities/work';
import { INTAKE_ACCEPT, INTAKE_FORMATS } from '@/shared/config/intake';
import { DropZone } from '@/shared/ui/DropZone';
import { itemsFromFiles } from '../model/intake-queue';
import type { IntakeItem } from '../model/types';
import styles from './FileTab.module.css';

export interface FileTabProps {
  works: Work[];
  local: boolean;
  onSwitchToPath: () => void;
  onAdd: (items: IntakeItem[]) => void;
}

export function FileTab({
  works,
  local,
  onSwitchToPath,
  onAdd,
}: FileTabProps): JSX.Element {
  const footnote = local ? (
    <span>
      Large master on this machine? Use{' '}
      <button
        type="button"
        className={styles.switchBtn}
        onClick={onSwitchToPath}
      >
        From this computer
      </button>
      : it is linked instantly, no copy
    </span>
  ) : (
    <span>Uploaded to the server inbox</span>
  );

  return (
    <DropZone
      accept={INTAKE_ACCEPT}
      formats={INTAKE_FORMATS}
      footnote={footnote}
      onFiles={(files) => onAdd(itemsFromFiles(files, works))}
    />
  );
}
