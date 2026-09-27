import { describe, expect, it } from 'vitest';
import { createFeed } from '../feed';

describe('createFeed', () => {
  it('notifies only on change, per the equality given', () => {
    const f = createFeed({ n: 1 }, (a, b) => a.n === b.n);
    let calls = 0;
    const off = f.subscribe(() => { calls++; });
    f.set({ n: 1 });
    f.set({ n: 2 });
    expect(calls).toBe(1);
    expect(f.get().n).toBe(2);
    off();
    f.set({ n: 3 });
    expect(calls).toBe(1);
  });
});
