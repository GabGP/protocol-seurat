import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { POPOVER_ICON_SIZE_PX } from '@/shared/config/dialog';
import { Icon } from './Icon';
import styles from './Popover.module.css';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export interface PopoverItemProps {
  icon?: string;
  label: string;
  onSelect: () => void;
  className?: string;
}

export function Popover({ open, onClose, children, className }: PopoverProps): JSX.Element | null {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div ref={popoverRef} role="menu" className={`${styles.popover} ${className ?? ''}`}>
      {children}
    </div>
  );
}

export function PopoverItem({ icon, label, onSelect, className }: PopoverItemProps): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={`${styles.item} ${className ?? ''}`}
      onClick={onSelect}
    >
      {icon && <Icon name={icon} size={POPOVER_ICON_SIZE_PX} className={styles.itemIcon} />}
      <span className={styles.itemLabel}>{label}</span>
    </button>
  );
}
