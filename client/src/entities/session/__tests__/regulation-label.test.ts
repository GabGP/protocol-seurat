import { describe, expect, it } from 'vitest';
import { serverLoadLabel } from '../regulation-label';

describe('serverLoadLabel', () => {
  it('returns Normal for null', () => {
    expect(serverLoadLabel(null)).toBe('Normal');
  });

  it('formats reduced rung with budget and multiple viewers', () => {
    expect(serverLoadLabel({ rung: 1, budgetKibS: 2048, capacityKibS: 0, sessions: 16 })).toBe(
      'Reduced (rung 1 of 3) · 2,048 KiB/s · 16 viewers',
    );
  });

  it('formats single viewer correctly', () => {
    expect(serverLoadLabel({ rung: 1, budgetKibS: 2048, capacityKibS: 0, sessions: 1 })).toBe(
      'Reduced (rung 1 of 3) · 2,048 KiB/s · 1 viewer',
    );
  });

  it('omits budget when budgetKibS is zero', () => {
    expect(serverLoadLabel({ rung: 2, budgetKibS: 0, capacityKibS: 0, sessions: 5 })).toBe(
      'Reduced (rung 2 of 3) · 5 viewers',
    );
  });
});
