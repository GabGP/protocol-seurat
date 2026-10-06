import { describe, expect, it, vi } from 'vitest';
import { createEvents } from '../providers/seurat/session-events';
import type { Runtime } from '../providers/seurat/runtime';
import type { Regulation } from '@/shared/proto/messages';

describe('regulation UI updates in sessionEvents', () => {
  it('calls setRegulation with object on rung 1 regulation', () => {
    const setRegulation = vi.fn();
    const rt = {
      alive: true,
      ui: { setRegulation },
      regulation: null,
    } as unknown as Runtime;
    const reconnect = { run: vi.fn(), welcomed: vi.fn() };
    const events = createEvents(rt, reconnect);

    const reg: Regulation = { rung: 1, budgetKibS: 2048, capacityKibS: 0, sessions: 16 };
    events.onRegulation?.(reg);

    expect(rt.regulation).toEqual(reg);
    expect(setRegulation).toHaveBeenCalledWith(reg);
  });

  it('calls setRegulation with null on rung 3 and budget 0', () => {
    const setRegulation = vi.fn();
    const rt = {
      alive: true,
      ui: { setRegulation },
      regulation: { rung: 1, budgetKibS: 2048, capacityKibS: 0, sessions: 16 },
    } as unknown as Runtime;
    const reconnect = { run: vi.fn(), welcomed: vi.fn() };
    const events = createEvents(rt, reconnect);

    const reg: Regulation = { rung: 3, budgetKibS: 0, capacityKibS: 0, sessions: 1 };
    events.onRegulation?.(reg);

    expect(rt.regulation).toBeNull();
    expect(setRegulation).toHaveBeenCalledWith(null);
  });
});
