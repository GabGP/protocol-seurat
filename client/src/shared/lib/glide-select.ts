import { SELECT_LIST_PAD_PX, SELECT_MENU_GAP_PX, SELECT_ROW_GAP_PX, SELECT_ROW_PX } from '@/shared/config/select';

/** Placement side of the dropdown menu relative to the trigger. */
export type MenuSide = 'top' | 'bottom';

/** Semantic action resolved from a keyboard interaction. */
export type MenuAction =
  | { kind: 'open' }
  | { kind: 'move'; index: number }
  | { kind: 'pick'; index: number }
  | { kind: 'close' }
  | { kind: 'none' };

/** Option row pitch in CSS px including row height and inter-row gap. */
export const SELECT_STEP_PX = SELECT_ROW_PX + SELECT_ROW_GAP_PX;

/** Scans forward from from+1 with wrapping for the first label starting with ch. */
export function typeaheadIndex(labels: readonly string[], from: number, ch: string): number {
  const c = ch.toLowerCase();
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const item = labels[i];
    if (item !== undefined && item.toLowerCase().startsWith(c)) return i;
  }
  return from;
}

/** Resolves option index at pointer vertical position, or null if outside list bounds. */
export function rowAt(y: number, listTop: number, count: number): number | null {
  const i = Math.floor((y - listTop - SELECT_LIST_PAD_PX) / SELECT_STEP_PX);
  return i >= 0 && i < count ? i : null;
}

/** Chooses menu placement side based on viewport space below and above the trigger. */
export function menuSide(trigger: { top: number; bottom: number }, menuH: number, viewportH: number): MenuSide {
  if (trigger.bottom + SELECT_MENU_GAP_PX + menuH <= viewportH) return 'bottom';
  if (trigger.top - SELECT_MENU_GAP_PX - menuH >= 0) return 'top';
  return 'bottom';
}

/**
 * What a key does to the select. The caller consumes (preventDefault + stopPropagation) every action except none,
 * and except the close for Tab, which keeps its default so focus moves on.
 */
export function menuKey(key: string, open: boolean, cur: number, labels: readonly string[]): MenuAction {
  const n = labels.length;
  if (n === 0) return { kind: 'none' };
  if (!open) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
      return { kind: 'open' };
    }
    return { kind: 'none' };
  }
  if (key === 'ArrowDown') return { kind: 'move', index: Math.min(n - 1, cur + 1) };
  if (key === 'ArrowUp') return { kind: 'move', index: Math.max(0, cur - 1) };
  if (key === 'Home') return { kind: 'move', index: 0 };
  if (key === 'End') return { kind: 'move', index: n - 1 };
  if (key === 'Enter' || key === ' ') return { kind: 'pick', index: cur };
  if (key === 'Escape' || key === 'Tab') return { kind: 'close' };
  if (key.length === 1) return { kind: 'move', index: typeaheadIndex(labels, cur, key) };
  return { kind: 'none' };
}
