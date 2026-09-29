import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ViewerInfoPanel } from '../index';

describe('ViewerInfoPanel', () => {
  it('renders info panel with rows and shortcut hotkeys', () => {
    const rows = [
      { k: 'Dimensions', v: '3,600 × 2,400 px' },
      { k: 'Resolution', v: '8.6 MP' },
    ];
    const html = renderToString(<ViewerInfoPanel rows={rows} onClose={() => {}} />);
    expect(html).toContain('Details');
    expect(html).toContain('Dimensions');
    expect(html).toContain('3,600 × 2,400 px');
    expect(html).toContain('Shortcuts');
    expect(html).toContain('Esc');
  });
});
