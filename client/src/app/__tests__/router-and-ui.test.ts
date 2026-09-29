import { describe, expect, it } from 'vitest';
import { parseOpenHash } from '@/features/open-work';
import { filterWorks, fixtureWorks, sortWorks } from '@/entities/work';
import { isOpenable, type Work } from '@/entities/work';
import { buildPresets } from '@/widgets/ZoomMenu';
import { counterLabel, stepIndex } from '@/features/navigate-work';
import { fmtPct, logFrac, logUnfrac } from '@/shared/lib/zoom';
import { clamp } from '@/shared/lib/clamp';

describe('Router & OpenHash', () => {
  it('parses viewer hash and ignores other hashes', () => {
    expect(parseOpenHash('#/visor/lamina-01')).toBe('lamina-01');
    expect(parseOpenHash('#/visor/my%20work')).toBe('my work');
    expect(parseOpenHash('#/')).toBeNull();
    expect(parseOpenHash('')).toBeNull();
    expect(parseOpenHash('#/other')).toBeNull();
  });
});

describe('Work filtering & fixtures', () => {
  it('fixtureWorks provides 12 plates', () => {
    const list = fixtureWorks();
    expect(list.length).toBe(12);
    expect(list[0]?.id).toBe('lamina-01');
    expect(list[11]?.id).toBe('lamina-12');
  });

  it('filters landscape vs portrait accurately', () => {
    const list = fixtureWorks();
    const all = filterWorks(list, 'all');
    const landscapes = filterWorks(list, 'landscape');
    const portraits = filterWorks(list, 'portrait');
    expect(all.length).toBe(12);
    expect(landscapes.length).toBe(8);
    expect(portraits.length).toBe(4);
    for (const w of landscapes) expect(w.width).toBeGreaterThanOrEqual(w.height);
    for (const w of portraits) expect(w.width).toBeLessThan(w.height);
  });

  it('sorts works in natural ascending order with numeric collation', () => {
    const unordered: Work[] = [
      { id: '3', name: 'Plate 10', width: 100, height: 100, strata: 1, state: 3, edition: 1, progress: 100 },
      { id: '1', name: 'Plate 2', width: 100, height: 100, strata: 1, state: 3, edition: 1, progress: 100 },
      { id: '2', name: 'Plate 1', width: 100, height: 100, strata: 1, state: 3, edition: 1, progress: 100 },
      { id: 'b', name: '', width: 100, height: 100, strata: 1, state: 3, edition: 1, progress: 100 },
      { id: 'a', name: '', width: 100, height: 100, strata: 1, state: 3, edition: 1, progress: 100 },
    ];
    const sorted = sortWorks(unordered);
    expect(sorted.map((w) => w.name || w.id)).toEqual(['a', 'b', 'Plate 1', 'Plate 2', 'Plate 10']);
  });

  it('opens LISTA, or BOCETO/PINTANDO only with a sketch (spec 7.3)', () => {
    const w = (state: Work['state'], edition: number): Work =>
      ({ id: 'x', name: '', width: 1, height: 1, strata: 1, state, edition, progress: 0 });
    expect(isOpenable(w(3, 2))).toBe(true);
    expect(isOpenable(w(1, 1))).toBe(true);
    expect(isOpenable(w(2, 1))).toBe(true);
    expect(isOpenable(w(2, 0))).toBe(false); // no overview: nothing to show until LISTA
    expect(isOpenable(w(0, 0))).toBe(false);
    expect(isOpenable(w(4, 1))).toBe(false);
  });
});

describe('Navigation helpers', () => {
  it('stepIndex handles wraparound in both directions', () => {
    expect(stepIndex(0, 1, 12)).toBe(1);
    expect(stepIndex(11, 1, 12)).toBe(0);
    expect(stepIndex(0, -1, 12)).toBe(11);
    expect(stepIndex(5, -1, 12)).toBe(4);
  });

  it('counterLabel formats 1-based index', () => {
    expect(counterLabel(0, 12)).toBe('1 / 12');
    expect(counterLabel(11, 12)).toBe('12 / 12');
  });
});

describe('Zoom & Preset calculations', () => {
  it('buildPresets produces expected labels, notes, and fit preset', () => {
    const presets = buildPresets(100, 24.5, 64, 12);
    expect(presets[0]?.label).toBe('Fit to screen');
    expect(presets[0]?.note).toBe('25%');
    expect(presets[0]?.zoom).toBeNull();

    const presetsSmall = buildPresets(100, 8.4, 64, 12);
    expect(presetsSmall[0]?.note).toBe('8.4%');

    const p100 = presets.find((p) => p.zoom === 100);
    expect(p100?.note).toBe('Actual pixels');
    expect(p100?.on).toBe(true);

    const p1600 = presets.find((p) => p.zoom === 1600);
    expect(p1600?.note).toBe('Dots'); // 1600% >= 1200% threshold
  });

  it('logFrac and logUnfrac invert each other accurately', () => {
    const minS = 0.05;
    const maxS = 64;
    for (const s of [0.05, 0.1, 0.5, 1, 4, 16, 64]) {
      const frac = logFrac(s, minS, maxS);
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThanOrEqual(1);
      const back = logUnfrac(frac, minS, maxS);
      expect(back).toBeCloseTo(s, 5);
    }
  });

  it('fmtPct formats integers and decimals appropriately', () => {
    expect(fmtPct(100)).toBe('100%');
    expect(fmtPct(4.56)).toBe('4.6%');
    expect(fmtPct(25600)).toBe('25,600%');
  });

  it('clamp pins values within [a, b]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
