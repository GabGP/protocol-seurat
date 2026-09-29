import { describe, expect, it } from 'vitest';
import { DecodeQueue } from '../decode-queue';

describe('DecodeQueue (cola_ms)', () => {
  it('returns to 0 once every brush is answered, however fast they decode', () => {
    const q = new DecodeQueue();
    for (let i = 0; i < 100; i++) q.posted();
    for (let i = 0; i < 100; i++) q.answered(2);
    expect(q.ms).toBe(0);
  });

  it('reports the backlog while brushes wait in the worker', () => {
    const q = new DecodeQueue();
    q.answered(20);
    q.answered(20);
    for (let i = 0; i < 10; i++) q.posted();
    expect(q.ms).toBeGreaterThan(100);
  });
});
