import type { ChangeEvent, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { DROP_FOLDER_ICON_PX } from '@/shared/config/dialog';
import { Icon } from './Icon';
import styles from './DropZone.module.css';

export interface DropZoneProps {
  accept?: string;
  formats?: readonly string[];
  footnote?: ReactNode;
  onFiles: (files: File[]) => void;
  className?: string;
}

export function DropZone({
  accept,
  formats,
  footnote,
  onFiles,
  className,
}: DropZoneProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length > 0) {
      onFiles(Array.from(list));
    }
    e.target.value = '';
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setDragging(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onFiles(Array.from(files));
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openPicker();
    }
  };

  const zoneCls = `${styles.zone} ${dragging ? styles.dragging : ''} ${className ?? ''}`;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop a master or browse files"
      className={zoneCls}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onKeyDown={handleKeyDown}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleInputChange}
        className={styles.hiddenInput}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className={styles.folderGlyph} aria-hidden="true">
        <Icon name="folder" size={DROP_FOLDER_ICON_PX} />
      </div>
      <div className={styles.prompt}>
        <span className={styles.title}>Drop a master or a .zip</span>
        <span className={styles.promptOr}>or</span>
        <button type="button" className={styles.browseBtn} onClick={openPicker}>
          browse
        </button>
      </div>
      {formats && formats.length > 0 && (
        <div className={styles.formatsRow}>
          {formats.map((fmt) => (
            <span key={fmt} className={styles.chip}>
              {fmt}
            </span>
          ))}
        </div>
      )}
      {footnote && <div className={styles.footnote}>{footnote}</div>}
    </div>
  );
}
