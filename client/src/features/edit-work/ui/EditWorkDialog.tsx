import { useState } from 'react';
import type { Work } from '@/entities/work';
import { Dialog } from '@/shared/ui/Dialog';
import { canRename, cleanName, type EditActions } from '../model/edit-work';
import { EditWorkForm } from './EditWorkForm';

export interface EditWorkDialogProps {
  work: Work | null;
  onClose(): void;
  actions: EditActions;
}

interface DialogBodyProps {
  work: Work;
  onClose(): void;
  actions: EditActions;
}

function EditWorkDialogBody({ work, onClose, actions }: DialogBodyProps): JSX.Element {
  const [name, setName] = useState(work.name);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);

  const canSave = canRename(name, work.name);

  const handleName = (value: string) => {
    setName(value);
    setFailed(false);
  };

  const handleSave = () => {
    if (busy || !canSave) return;
    setBusy(true);
    setFailed(false);
    actions
      .rename(work.id, cleanName(name))
      .then(() => {
        onClose();
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const handleDelete = () => {
    if (!confirming) {
      setConfirming(true);
      setFailed(false);
      return;
    }
    if (busy) return;
    setBusy(true);
    setFailed(false);
    actions
      .remove(work.id)
      .then(() => {
        onClose();
      })
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const handleCancelDelete = () => {
    setConfirming(false);
  };

  return (
    <EditWorkForm
      name={name}
      onName={handleName}
      canSave={canSave}
      busy={busy}
      confirming={confirming}
      failed={failed}
      onSave={handleSave}
      onDelete={handleDelete}
      onCancelDelete={handleCancelDelete}
    />
  );
}

export function EditWorkDialog({ work, onClose, actions }: EditWorkDialogProps): JSX.Element | null {
  return (
    <Dialog open={work !== null} onClose={onClose} title="Edit work">
      {work && (
        <EditWorkDialogBody
          key={work.id}
          work={work}
          onClose={onClose}
          actions={actions}
        />
      )}
    </Dialog>
  );
}
