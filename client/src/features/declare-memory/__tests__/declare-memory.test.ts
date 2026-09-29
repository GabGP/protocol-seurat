import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareMemMib, loadMemOverride } from '@/entities/session';
import { applyMemory, brushesFor, memoryChoices } from '../model/declare-memory';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, v); },
  };
}

describe('declared memory', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('navigator', { deviceMemory: 8 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('declares the spec formula until the user picks a value, then that value', () => {
    expect(declareMemMib()).toBe(256);
    applyMemory(48, vi.fn());
    expect(declareMemMib()).toBe(48);
    expect(loadMemOverride()).toBe(48);
    applyMemory(null, vi.fn());
    expect(declareMemMib()).toBe(256);
  });

  it('starts a new session on change: the resume ticket is dropped and the page restarts', () => {
    sessionStorage.setItem('seurat.session', '7');
    const restart = vi.fn();
    applyMemory(64, restart);
    expect(sessionStorage.getItem('seurat.session')).toBeNull();
    expect(restart).toHaveBeenCalledOnce();
  });

  it('ignores a garbage stored value', () => {
    localStorage.setItem('seurat.memMib', 'abc');
    expect(declareMemMib()).toBe(256);
  });

  it('lists the spec default first and shows the brushes each size grants (spec 6.1)', () => {
    expect(memoryChoices().map((c) => c.mib)).toEqual([null, 80, 64, 48, 32]);
    expect([80, 64, 48, 32].map(brushesFor)).toEqual([240, 192, 144, 96]);
    expect(brushesFor(256)).toBe(256);
  });
});
