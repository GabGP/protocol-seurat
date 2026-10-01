import type { HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { useRef } from 'react';
import { rowAt } from '@/shared/lib/glide-select';

/** Handlers mapped to listbox element pointer events. */
export type ScrubHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  'onPointerOver' | 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
>;

/** Manages pointer capture scrubbing and hover tracking over option rows. */
export function useListScrub(
  count: number,
  active: number | null,
  setActive: (i: number | null, instant?: boolean) => void,
  pick: (i: number, viaKey: boolean) => void
): ScrubHandlers {
  const scrub = useRef<{ id: number; top: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrub.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; scrubbing still works without capture.
    }
    const top = e.currentTarget.getBoundingClientRect().top;
    scrub.current = { id: e.pointerId, top };
    setActive(rowAt(e.clientY, top, count), true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = scrub.current;
    if (!current || current.id !== e.pointerId) return;
    const i = rowAt(e.clientY, current.top, count);
    if (i !== active) {
      setActive(i);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = scrub.current;
    if (!current || current.id !== e.pointerId) return;
    const i = e.type === 'pointerup' ? rowAt(e.clientY, current.top, count) : null;
    scrub.current = null;
    if (i !== null) {
      pick(i, false);
    }
  };

  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || scrub.current) return;
    const target = e.target as HTMLElement | null;
    const row = target?.closest?.('[data-index]') as HTMLElement | null;
    if (!row) return;
    const i = Number(row.dataset.index);
    if (!Number.isNaN(i) && i !== active) {
      setActive(i);
    }
  };

  return {
    onPointerOver,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
  };
}
