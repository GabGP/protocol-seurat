import { describe, expect, it } from 'vitest';
import { pageRange, paginate } from '../pagination';

describe('paginate', () => {
  it('handles empty list giving count 1 and page 0', () => {
    const res = paginate([], 0, 8);
    expect(res).toEqual({
      items: [],
      page: 0,
      count: 1,
      offset: 0,
    });
  });

  it('clamps page past the end to the last page', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const res = paginate(items, 99, 4);
    expect(res.count).toBe(3);
    expect(res.page).toBe(2);
    expect(res.offset).toBe(8);
    expect(res.items).toEqual([9, 10]);
  });

  it('clamps negative page and computes offset accurately', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const resNeg = paginate(items, -3, 2);
    expect(resNeg.page).toBe(0);
    expect(resNeg.offset).toBe(0);
    expect(resNeg.items).toEqual(['a', 'b']);

    const resPage1 = paginate(items, 1, 2);
    expect(resPage1.page).toBe(1);
    expect(resPage1.offset).toBe(2);
    expect(resPage1.items).toEqual(['c', 'd']);
  });
});

describe('pageRange', () => {
  it('returns [0] for count 1', () => {
    expect(pageRange(0, 1, 1)).toEqual([0]);
    expect(pageRange(5, 1, 1)).toEqual([0]);
  });

  it('returns [0, 1, 2, 3, 4] for count 5 with page 2', () => {
    expect(pageRange(2, 5, 1)).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns [0, 1, "gap", 9] for count 10 with page 0', () => {
    expect(pageRange(0, 10, 1)).toEqual([0, 1, 'gap', 9]);
  });

  it('returns [0, "gap", 4, 5, 6, "gap", 9] for count 10 with page 5', () => {
    expect(pageRange(5, 10, 1)).toEqual([0, 'gap', 4, 5, 6, 'gap', 9]);
  });

  it('returns [0, 1, 2, 3, "gap", 9] for count 10 with page 2', () => {
    expect(pageRange(2, 10, 1)).toEqual([0, 1, 2, 3, 'gap', 9]);
  });

  it('shows single hidden page number instead of gap', () => {
    expect(pageRange(3, 7, 1)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
