import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useId } from 'react';
import { WORK_NAME_MAX } from '@/shared/config/protocol';
import styles from './EditWorkForm.module.css';

export interface EditWorkFormProps {
  name: string;
  onName: (value: string) => void;
  canSave: boolean;
  busy: boolean;
  confirming: boolean;
  failed: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}

export function EditWorkForm({
  name,
  onName,
  canSave,
  busy,
  confirming,
  failed,
  onSave,
  onDelete,
  onCancelDelete,
}: EditWorkFormProps): JSX.Element {
  const inputId = useId();

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canSave && !busy) {
        onSave();
      }
    }
  };

  return (
    <div className={styles.form}>
      <label htmlFor={inputId} className={styles.label}>
        Name
      </label>
      <div className={styles.inputRow}>
        <input
          id={inputId}
          type="text"
          className={styles.input}
          value={name}
          maxLength={WORK_NAME_MAX}
          aria-label="Work name"
          disabled={busy}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={styles.importBtn}
          disabled={!canSave || busy}
          onClick={onSave}
        >
          Save
        </button>
      </div>
      <p className={styles.hint}>
        The name changes for every viewer. The file on the server keeps its name.
      </p>
      <hr className={styles.divider} />
      <div className={styles.dangerZone}>
        {!confirming ? (
          <button
            type="button"
            className={styles.deleteBtn}
            disabled={busy}
            onClick={onDelete}
          >
            Delete work
          </button>
        ) : (
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>
              Delete this work for every viewer? This cannot be undone.
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.dangerBtn}
                disabled={busy}
                onClick={onDelete}
              >
                Delete
              </button>
              <button
                type="button"
                className={styles.cancelBtn}
                disabled={busy}
                onClick={onCancelDelete}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {failed && (
        <p className={styles.failed}>
          Could not apply the change. Try again.
        </p>
      )}
    </div>
  );
}
