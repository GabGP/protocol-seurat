import { describe, expect, it } from 'vitest';
import { AttentionHeat } from '../attention-heat';
import { GazeMotion } from '../gaze-motion';

describe('GazeMotion (α-β filter)', () => {
  it('converges to a constant pan and zoom velocity', () => {
    const g = new GazeMotion();
    for (let i = 0; i <= 60; i++) g.observe(i * 0.05, 1000 + 400 * i * 0.05, 500, 3 - 0.5 * i * 0.05, 800);
    const s = g.state(3)!;
    expect(s.vx).toBeCloseTo(400, 0);
    expect(s.vy).toBeCloseTo(0, 3);
    expect(s.vz).toBeCloseTo(-0.5, 2);
    expect(s.x).toBe(1000 + 400 * 3); // position is the last measurement, not the smoothed one
  });

  it('forgets velocity once views stop arriving, and restarts after a stale gap', () => {
    const g = new GazeMotion();
    for (let i = 0; i <= 40; i++) g.observe(i * 0.05, 300 * i * 0.05, 0, 1, 500);
    expect(Math.abs(g.state(2 + 5)!.vx)).toBeLessThan(1);
    g.observe(10, 0, 0, 1, 500);
    expect(g.state(10)!.vx).toBe(0);
  });

  it('has no state before the first view', () => {
    expect(new GazeMotion().state(1)).toBeNull();
  });
});

describe('AttentionHeat', () => {
  it('accumulates dwell, caps one view, decays by half-life and prunes', () => {
    const h = new AttentionHeat();
    h.warm('a', 2, 0);
    h.warm('a', 3, 0);
    expect(h.heat('a', 0)).toBe(5);
    h.warm('b', 1e6, 0);
    expect(h.heat('b', 0)).toBeLessThan(1e6);
    expect(h.heat('a', 120)).toBeCloseTo(2.5, 5);
    h.prune(new Set(['b']));
    expect(h.heat('a', 0)).toBe(0);
    expect(h.heat('b', 0)).toBeGreaterThan(0);
  });
});
