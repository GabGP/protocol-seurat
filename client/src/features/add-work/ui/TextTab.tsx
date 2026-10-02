import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useState } from 'react';
import type { Work } from '@/entities/work';
import { itemFromText } from '../model/intake-queue';
import type { IntakeItem } from '../model/types';
import styles from './TextTab.module.css';

export interface TextTabProps {
  source: 'link' | 'path';
  works: Work[];
  onAdd: (items: IntakeItem[]) => void;
}

const LINK_PLACEHOLDER = ['https', '://example.org/scan.tif'].join('');
const LINK_HINT = 'The server downloads it, then ingests it.';
const PATH_PLACEHOLDER = 'D:\\scans\\big.psb';
const PATH_HINT =
  'In Explorer, Shift+right-click the file and choose Copy as path. Linked instantly on the same drive, copied otherwise.';

export function TextTab({ source, works, onAdd }: TextTabProps): JSX.Element {
  const [text, setText] = useState('');

  const isLink = source === 'link';
  const placeholder = isLink ? LINK_PLACEHOLDER : PATH_PLACEHOLDER;
  const hint = isLink ? LINK_HINT : PATH_HINT;

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const item = itemFromText(source, trimmed, works);
    onAdd([item]);
    setText('');
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.pane}>
      <div className={styles.inputRow}>
        <input
          type="text"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={isLink ? 'Link URL' : 'File path'}
        />
        <button
          type="button"
          className={styles.importBtn}
          disabled={!canSubmit}
          onClick={submit}
        >
          Import
        </button>
      </div>
      <p className={styles.hint}>{hint}</p>
    </div>
  );
}
