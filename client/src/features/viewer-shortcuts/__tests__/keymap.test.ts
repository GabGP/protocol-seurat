import { describe, expect, it, vi } from 'vitest';
import { KEY_PAN_STEP_PX, ZOOM_STEP_FACTOR } from '@/shared/config/view';
import { handleKey, type ShortcutActions, type ShortcutHost } from '../index';

function rig(): { host: ShortcutHost; actions: ShortcutActions; calls: string[] } {
  const calls: string[] = [];
  const actions = Object.fromEntries(
    ['onToggleLoupe', 'onDiveDots', 'onToggleInfo', 'onToggleTelemetry', 'onToggleSettings', 'onPrev', 'onNext', 'onBack', 'onCloseMenu'].map(
      (n) => [n, () => calls.push(n)],
    ),
  ) as unknown as ShortcutActions;
  const host: ShortcutHost = {
    actions: () => actions,
    zoomFrom: (next) => calls.push(`zoom:${next(10)}`),
    zoomTo: (s) => calls.push(`zoomTo:${s}`),
    fit: (imm) => calls.push(`fit:${imm}`),
    nudge: (dx, dy) => calls.push(`nudge:${dx},${dy}`),
  };
  return { host, actions, calls };
}

const key = (k: string, tag = 'DIV'): { e: KeyboardEvent; prevented: () => boolean } => {
  const preventDefault = vi.fn();
  return { e: { key: k, target: { tagName: tag }, preventDefault } as unknown as KeyboardEvent, prevented: () => preventDefault.mock.calls.length > 0 };
};

describe('viewer shortcuts', () => {
  it('zooms in and out by the step factor, both key spellings', () => {
    const { host, calls } = rig();
    for (const k of ['+', '=', '-', '_']) handleKey(key(k).e, host);
    expect(calls).toEqual([`zoom:${10 * ZOOM_STEP_FACTOR}`, `zoom:${10 * ZOOM_STEP_FACTOR}`, `zoom:${10 / ZOOM_STEP_FACTOR}`, `zoom:${10 / ZOOM_STEP_FACTOR}`]);
  });

  it('fits with 0, goes to 1:1 with 1', () => {
    const { host, calls } = rig();
    handleKey(key('0').e, host);
    handleKey(key('1').e, host);
    expect(calls).toEqual(['fit:false', 'zoomTo:1']);
  });

  it('arrows move the view target the same way as before', () => {
    const { host, calls } = rig();
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) handleKey(key(k).e, host);
    const s = KEY_PAN_STEP_PX;
    expect(calls).toEqual([`nudge:${s},0`, `nudge:${-s},0`, `nudge:0,${s}`, `nudge:0,${-s}`]);
  });

  it('runs the page actions, letters in either case', () => {
    const { host, calls } = rig();
    for (const k of ['l', 'L', 'p', 'I', 't', 'S', '[', ']', 'Escape']) handleKey(key(k).e, host);
    expect(calls).toEqual(['onToggleLoupe', 'onToggleLoupe', 'onDiveDots', 'onToggleInfo', 'onToggleTelemetry', 'onToggleSettings', 'onPrev', 'onNext', 'onBack']);
  });

  it('prevents the default of a handled key only', () => {
    const { host } = rig();
    const hit = key('l');
    const miss = key('q');
    expect(handleKey(hit.e, host)).toBe(true);
    expect(hit.prevented()).toBe(true);
    expect(handleKey(miss.e, host)).toBe(false);
    expect(miss.prevented()).toBe(false);
  });

  it('leaves typing in a field alone', () => {
    const { host, calls } = rig();
    expect(handleKey(key('l', 'INPUT').e, host)).toBe(false);
    expect(handleKey(key('0', 'TEXTAREA').e, host)).toBe(false);
    expect(calls).toEqual([]);
  });
});
