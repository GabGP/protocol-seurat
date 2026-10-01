import { describe, expect, it } from 'vitest';
import { menuKey, menuSide, rowAt, SELECT_STEP_PX, typeaheadIndex } from '../glide-select';

describe('typeaheadIndex', () => {
  const labels = ['Apple', 'Banana', 'Cherry', 'Avocado'];

  it('wraps past the end', () => {
    expect(typeaheadIndex(labels, 3, 'b')).toBe(1);
    expect(typeaheadIndex(labels, 2, 'a')).toBe(3);
  });

  it('is case insensitive', () => {
    expect(typeaheadIndex(labels, 0, 'b')).toBe(1);
    expect(typeaheadIndex(labels, 0, 'B')).toBe(1);
    expect(typeaheadIndex(labels, 1, 'c')).toBe(2);
    expect(typeaheadIndex(labels, 1, 'C')).toBe(2);
  });

  it('returns from when nothing matches', () => {
    expect(typeaheadIndex(labels, 1, 'z')).toBe(1);
    expect(typeaheadIndex([], 0, 'a')).toBe(0);
  });
});

describe('rowAt', () => {
  const listTop = 100;
  const count = 3;

  it('identifies the first row', () => {
    expect(rowAt(104, listTop, count)).toBe(0);
    expect(rowAt(120, listTop, count)).toBe(0);
  });

  it('identifies a later row', () => {
    expect(rowAt(104 + SELECT_STEP_PX, listTop, count)).toBe(1);
    expect(rowAt(104 + 2 * SELECT_STEP_PX, listTop, count)).toBe(2);
  });

  it('returns null above the list and null past the last row', () => {
    expect(rowAt(103, listTop, count)).toBeNull();
    expect(rowAt(50, listTop, count)).toBeNull();
    expect(rowAt(104 + count * SELECT_STEP_PX, listTop, count)).toBeNull();
    expect(rowAt(300, listTop, count)).toBeNull();
  });
});

describe('menuSide', () => {
  it('returns bottom when room below trigger', () => {
    expect(menuSide({ top: 50, bottom: 82 }, 120, 600)).toBe('bottom');
  });

  it('returns top near viewport bottom', () => {
    expect(menuSide({ top: 520, bottom: 552 }, 100, 600)).toBe('top');
  });

  it('returns bottom when neither fits', () => {
    expect(menuSide({ top: 30, bottom: 62 }, 200, 100)).toBe('bottom');
  });
});

describe('menuKey', () => {
  const labels = ['Alpha', 'Beta', 'Gamma'];

  it('returns none when labels array is empty', () => {
    expect(menuKey('Enter', false, 0, [])).toEqual({ kind: 'none' });
    expect(menuKey(' ', false, 0, [])).toEqual({ kind: 'none' });
    expect(menuKey('ArrowDown', true, 0, [])).toEqual({ kind: 'none' });
  });

  it('handles closed keys for open vs none', () => {
    expect(menuKey('Enter', false, 0, labels)).toEqual({ kind: 'open' });
    expect(menuKey(' ', false, 0, labels)).toEqual({ kind: 'open' });
    expect(menuKey('ArrowDown', false, 0, labels)).toEqual({ kind: 'open' });
    expect(menuKey('ArrowUp', false, 0, labels)).toEqual({ kind: 'open' });
    expect(menuKey('a', false, 0, labels)).toEqual({ kind: 'none' });
    expect(menuKey('Escape', false, 0, labels)).toEqual({ kind: 'none' });
    expect(menuKey('Tab', false, 0, labels)).toEqual({ kind: 'none' });
  });

  it('handles each open navigation and selection key', () => {
    expect(menuKey('ArrowDown', true, 0, labels)).toEqual({ kind: 'move', index: 1 });
    expect(menuKey('ArrowDown', true, 2, labels)).toEqual({ kind: 'move', index: 2 });
    expect(menuKey('ArrowUp', true, 2, labels)).toEqual({ kind: 'move', index: 1 });
    expect(menuKey('ArrowUp', true, 0, labels)).toEqual({ kind: 'move', index: 0 });
    expect(menuKey('Home', true, 2, labels)).toEqual({ kind: 'move', index: 0 });
    expect(menuKey('End', true, 0, labels)).toEqual({ kind: 'move', index: 2 });
    expect(menuKey('Enter', true, 1, labels)).toEqual({ kind: 'pick', index: 1 });
    expect(menuKey(' ', true, 1, labels)).toEqual({ kind: 'pick', index: 1 });
    expect(menuKey('Escape', true, 1, labels)).toEqual({ kind: 'close' });
    expect(menuKey('Tab', true, 1, labels)).toEqual({ kind: 'close' });
  });

  it('handles typeahead for character keys and ignores unsupported keys', () => {
    expect(menuKey('b', true, 0, labels)).toEqual({ kind: 'move', index: 1 });
    expect(menuKey('g', true, 0, labels)).toEqual({ kind: 'move', index: 2 });
    expect(menuKey('z', true, 0, labels)).toEqual({ kind: 'move', index: 0 });
    expect(menuKey('PageDown', true, 0, labels)).toEqual({ kind: 'none' });
  });
});
