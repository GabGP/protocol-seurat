import { describe, expect, it } from 'vitest';
import { ingestBadge, WORK_STATE, type Work } from '../types';

function makeWork(state: Work['state'], progress = 0): Work {
  return {
    id: 'test-work',
    name: 'Plate',
    width: 800,
    height: 600,
    strata: 4,
    state,
    edition: 1,
    progress,
  };
}

describe('WORK_STATE spec numbering', () => {
  it('maps each state constant to its protocol number', () => {
    expect(WORK_STATE.RECEIVING).toBe(0);
    expect(WORK_STATE.SKETCH).toBe(1);
    expect(WORK_STATE.PAINTING).toBe(2);
    expect(WORK_STATE.READY).toBe(3);
    expect(WORK_STATE.FAILED).toBe(4);
    expect(WORK_STATE.WITHDRAWN).toBe(5);
  });
});

describe('ingestBadge', () => {
  it('returns Receiving for state 0 (RECEIVING)', () => {
    expect(ingestBadge(makeWork(WORK_STATE.RECEIVING))).toBe('Receiving');
    expect(ingestBadge(makeWork(0, 50))).toBe('Receiving');
  });

  it('returns Processing N% for state 1 (SKETCH) and state 2 (PAINTING)', () => {
    expect(ingestBadge(makeWork(WORK_STATE.SKETCH, 0))).toBe('Processing 0%');
    expect(ingestBadge(makeWork(WORK_STATE.SKETCH, 45.4))).toBe('Processing 45%');
    expect(ingestBadge(makeWork(WORK_STATE.SKETCH, 45.6))).toBe('Processing 46%');
    expect(ingestBadge(makeWork(WORK_STATE.PAINTING, 75))).toBe('Processing 75%');
    expect(ingestBadge(makeWork(WORK_STATE.PAINTING, 99.9))).toBe('Processing 100%');
  });

  it('clamps progress to 0..100 for processing states', () => {
    expect(ingestBadge(makeWork(WORK_STATE.SKETCH, -15))).toBe('Processing 0%');
    expect(ingestBadge(makeWork(WORK_STATE.PAINTING, 120))).toBe('Processing 100%');
  });

  it('returns Failed for state 4 (FAILED)', () => {
    expect(ingestBadge(makeWork(WORK_STATE.FAILED))).toBe('Failed');
    expect(ingestBadge(makeWork(4, 80))).toBe('Failed');
  });

  it('returns null for state 3 (READY) and state 5 (WITHDRAWN)', () => {
    expect(ingestBadge(makeWork(WORK_STATE.READY, 100))).toBeNull();
    expect(ingestBadge(makeWork(WORK_STATE.WITHDRAWN, 0))).toBeNull();
  });
});
