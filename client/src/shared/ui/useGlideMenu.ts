import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SELECT_MENU_GAP_PX, SELECT_POP_OUT_MS } from '@/shared/config/select';
import { menuSide, SELECT_STEP_PX } from '@/shared/lib/glide-select';

/** Animation and visibility phase of the dropdown menu. */
export type Phase = 'closed' | 'open' | 'closing';

export interface UseGlideMenuResult {
  phase: Phase;
  active: number | null;
  setActive(i: number | null, instant?: boolean): void;
  open(viaKey: boolean): void;
  close(mode: 'instant' | 'pop'): void;
  rootRef: RefObject<HTMLDivElement>;
  triggerRef: RefObject<HTMLButtonElement>;
  menuRef: RefObject<HTMLDivElement>;
  pillRef: RefObject<HTMLSpanElement>;
}

/** Controls open/closing lifecycle, fixed positioning, and gliding pill coordinates. */
export function useGlideMenu(selected: number): UseGlideMenuResult {
  const [phase, setPhase] = useState<Phase>('closed');
  const [active, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const instant = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setActive = useCallback((i: number | null, isInstant?: boolean) => {
    if (isInstant !== undefined) instant.current = isInstant;
    setActiveIndex(i);
  }, []);

  const open = useCallback(
    (viaKey: boolean) => {
      clearTimeout(closeTimer.current);
      instant.current = true;
      setActive(selected >= 0 ? selected : viaKey ? 0 : null);
      setPhase('open');
    },
    [selected, setActive]
  );

  const close = useCallback(
    (mode: 'instant' | 'pop') => {
      setActive(null);
      clearTimeout(closeTimer.current);
      const menu = menuRef.current;
      if (mode === 'instant' || !menu) {
        setPhase('closed');
        return;
      }
      menu.style.transitionDuration = '';
      menu.dataset.state = 'closed';
      setPhase('closing');
      closeTimer.current = setTimeout(() => setPhase('closed'), SELECT_POP_OUT_MS);
    },
    [setActive]
  );

  useLayoutEffect(() => {
    if (phase !== 'open') return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
    const side = menuSide(rect, menu.offsetHeight, window.innerHeight);
    if (side === 'bottom') {
      menu.style.top = `${rect.bottom + SELECT_MENU_GAP_PX}px`;
      menu.style.bottom = '';
    } else {
      menu.style.bottom = `${window.innerHeight - rect.top + SELECT_MENU_GAP_PX}px`;
      menu.style.top = '';
    }
    menu.dataset.side = side;
    menu.style.transitionDuration = instant.current ? '0ms' : '';
    menu.dataset.state = 'closed';
    void menu.offsetHeight;
    menu.dataset.state = 'open';
    const pill = pillRef.current;
    if (pill) {
      pill.style.transition = 'none';
      pill.style.transform = `translateY(${Math.max(0, selected) * SELECT_STEP_PX}px)`;
      pill.style.opacity = '0';
      void pill.offsetHeight;
      pill.style.transition = '';
    }
    // Reads `selected` as of opening: a later change while open must not replay the pop.
  }, [phase]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill || phase !== 'open') return;
    if (active === null) {
      pill.style.opacity = '0';
      return;
    }
    const jump = instant.current || pill.style.opacity !== '1';
    pill.style.transitionDuration = jump ? '0ms, 150ms' : '';
    pill.style.transform = `translateY(${active * SELECT_STEP_PX}px)`;
    pill.style.opacity = '1';
    instant.current = false;
  }, [active, phase]);

  useEffect(() => {
    if (phase === 'closed') return undefined;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close('pop');
    };
    const onDrift = () => close('instant');
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onDrift, true);
    document.addEventListener('scroll', onDrift, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onDrift, true);
      document.removeEventListener('scroll', onDrift, true);
    };
  }, [phase, close]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  return { phase, active, setActive, open, close, rootRef, triggerRef, menuRef, pillRef };
}
