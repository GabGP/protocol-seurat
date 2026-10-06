import { describe, expect, it } from 'vitest';
import { aspectLabel, buildViewerInfoRows, connectionLabel } from './viewerInfoRows';

describe('viewer info rows', () => {
  it('shows the real aspect ratio of the image', () => {
    expect(aspectLabel(136325, 136325)).toBe('1 : 1');
    expect(aspectLabel(3000, 2000)).toBe('3 : 2');
    expect(aspectLabel(2000, 3000)).toBe('2 : 3');
    expect(aspectLabel(14645, 12158)).toBe('1.20 : 1');
    expect(aspectLabel(12158, 14645)).toBe('1 : 1.20');
    expect(aspectLabel(0, 0)).toBe('—');
  });

  it('reads the session status as a connection state', () => {
    expect(connectionLabel('boot')).toBe('Connecting');
    expect(connectionLabel('hello')).toBe('Connected');
    expect(connectionLabel('offline: no route')).toBe('offline: no route');
  });

  it('builds the rows in order, with the tag only when the work has one', () => {
    const rows = buildViewerInfoRows('100 × 100', '0.01 MP', 100, 100, 50, 'hello', 'Normal');
    expect(rows.map((r) => r.k)).toEqual(['Dimensions', 'Resolution', 'Aspect ratio', 'Fit zoom', 'Max zoom', 'Dots from', 'Connection', 'Server load']);
    expect(rows.find((r) => r.k === 'Aspect ratio')?.v).toBe('1 : 1');
    expect(rows.find((r) => r.k === 'Connection')?.v).toBe('Connected');
    expect(buildViewerInfoRows('1', '1', 1, 1, 1, 'hello', 'Normal', 'maps').some((r) => r.k === 'Tag')).toBe(true);
  });
});
