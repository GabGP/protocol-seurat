import type { AnimationEvent as ReactAnimationEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useId } from 'react';
import { createPortal } from 'react-dom';
import { ICON_XS } from '@/shared/config/icon';
import { SELECT_GLIDE_MS, SELECT_LIST_PAD_PX, SELECT_POP_MS, SELECT_POP_OUT_MS, SELECT_ROW_PX } from '@/shared/config/select';
import { menuKey } from '@/shared/lib/glide-select';
import styles from './GlideSelect.module.css';
import { Icon } from './Icon';
import { useGlideMenu } from './useGlideMenu';
import { useListScrub } from './useListScrub';

export interface Choice<T> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange(value: T): void;
}

/** Accessible dropdown select with animated glide pill and typeahead navigation. */
export function GlideSelect<T extends string | number>({ label, choices, value, onChange }: Props<T>): JSX.Element {
  const id = useId();
  const labels = choices.map((c) => c.label);
  const selected = choices.findIndex((c) => c.value === value);

  const { phase, active, setActive, open, close, rootRef, triggerRef, menuRef, pillRef } = useGlideMenu(selected);

  const pick = (i: number, viaKey: boolean) => {
    const choice = choices[i];
    if (choice && choice.value !== value) {
      onChange(choice.value);
      if (!viaKey && rootRef.current) rootRef.current.dataset.swap = '';
    }
    close('instant');
    triggerRef.current?.focus({ preventScroll: true });
  };

  const scrub = useListScrub(choices.length, active, setActive, pick);

  const onTriggerPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.focus({ preventScroll: true });
    if (phase === 'open') close('pop');
    else open(false);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = active ?? Math.max(0, selected);
    const action = menuKey(e.key, phase === 'open', cur, labels);
    if (action.kind === 'none') return;
    if (e.key !== 'Tab') {
      e.preventDefault();
      e.stopPropagation();
    }
    if (action.kind === 'open') open(true);
    else if (action.kind === 'move') setActive(action.index, true);
    else if (action.kind === 'pick') pick(action.index, true);
    else if (action.kind === 'close') close('instant');
  };

  const onRootAnimationEnd = (e: ReactAnimationEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (rootRef.current && styles.label && target?.classList?.contains(styles.label)) {
      delete rootRef.current.dataset.swap;
    }
  };

  const selectedChoice = choices[selected];
  const selectedLabel = selectedChoice ? selectedChoice.label : '';
  const menuVars = {
    '--gs-row': `${SELECT_ROW_PX}px`,
    '--gs-pad': `${SELECT_LIST_PAD_PX}px`,
    '--gs-pop': `${SELECT_POP_MS}ms`,
    '--gs-pop-out': `${SELECT_POP_OUT_MS}ms`,
    '--gs-glide': `${SELECT_GLIDE_MS}ms`,
  } as CSSProperties;

  return (
    <div ref={rootRef} className={styles.root} onAnimationEnd={onRootAnimationEnd}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={phase === 'open'}
        aria-controls={`${id}-list`}
        aria-activedescendant={active !== null ? `${id}-${active}` : undefined}
        aria-label={label}
        className={styles.trigger}
        onPointerDown={onTriggerPointerDown}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={styles.label} key={String(value)}>{selectedLabel}</span>
        <span className={styles.chevron} aria-hidden="true">
          <Icon name="arrow_drop_down" size={ICON_XS} />
        </span>
      </button>
      {phase !== 'closed' &&
        createPortal(
          <div ref={menuRef} className={styles.menu} data-state="open" style={menuVars}>
            <div role="listbox" id={`${id}-list`} aria-label={label} className={styles.list} data-live={active !== null ? '' : undefined} {...scrub}>
              <span ref={pillRef} className={styles.pill} aria-hidden="true" />
              {choices.map((c, i) => (
                <div key={String(c.value)} id={`${id}-${i}`} role="option" aria-selected={i === selected} data-index={i} className={styles.option}>
                  <span className={styles.name}>{c.label}</span>
                  <span className={styles.check} data-on={i === selected ? '' : undefined} aria-hidden="true">
                    <Icon name="check" size={ICON_XS} />
                  </span>
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
