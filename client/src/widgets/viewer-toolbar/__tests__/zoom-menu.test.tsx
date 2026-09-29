import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ZoomMenu } from '../index';

describe('ZoomMenu', () => {
  it('renders zoom presets and note strings', () => {
    const presets = [
      { label: 'Fit to screen', note: '25%', on: false, zoom: null },
      { label: '100%', note: 'Actual pixels', on: true, zoom: 100 },
    ];
    const html = renderToString(<ZoomMenu presets={presets} onPick={() => {}} />);
    expect(html).toContain('Fit to screen');
    expect(html).toContain('Actual pixels');
    expect(html).toContain('100%');
  });

});
