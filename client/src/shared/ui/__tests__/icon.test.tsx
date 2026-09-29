import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Icon } from '../Icon';

describe('Icon component (offline SVG)', () => {
  it('renders SVG element for known icons without falling back to text', () => {
    const icons = [
      'blur_on', 'arrow_forward', 'arrow_back', 'chevron_left', 'chevron_right',
      'check', 'info', 'remove', 'add', 'arrow_drop_down', 'fit_screen', 'search', 'close',
    ];
    for (const name of icons) {
      const html = renderToString(<Icon name={name} size={24} />);
      expect(html).toContain('<svg');
      expect(html).not.toContain(`>${name}<`);
    }
  });

  it('renders span fallback for unknown icon', () => {
    const html = renderToString(<Icon name="unknown_glyph" size={24} />);
    expect(html).toContain('<span');
    expect(html).toContain('unknown_glyph');
  });
});

