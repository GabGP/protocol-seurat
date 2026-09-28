import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Icon } from '@/shared/ui/Icon';
import { StatusPill } from '@/widgets/StatusPill';
import { LoadError } from '@/widgets/LoadError';
import { SlowScriptCard, SlowScriptNotice } from '@/widgets/SlowScriptNotice';
import { ZoomMenu } from '@/widgets/ZoomMenu';
import { ViewerInfoPanel } from '@/widgets/ViewerInfoPanel';

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

describe('StatusPill component', () => {
  it('renders guidance hint when view or px is null', () => {
    const html = renderToString(<StatusPill px={null} />);
    expect(html).toContain('Wheel to zoom · drag to pan · double click to dive in');
  });

  it('renders X, Y and color hex swatch when pixel is focused', () => {
    const html = renderToString(<StatusPill px={{ x: '1,200', y: '800', hex: '#4355B9' }} />);
    expect(html).toContain('1,200');
    expect(html).toContain('800');
    expect(html).toContain('#4355B9');
  });
});

describe('LoadError component', () => {
  it('renders error notice and retry CTA', () => {
    const html = renderToString(<LoadError onRetry={() => {}} />);
    expect(html).toContain('Could not load this image.');
    expect(html).toContain('Retry');
  });
});

describe('SlowScriptNotice', () => {
  it('names no browser and offers a dismiss control', () => {
    const html = renderToString(<SlowScriptCard onDismiss={() => {}} />);
    expect(html).toContain('without optimizations');
    expect(html).toContain('aria-label="Dismiss"');
    expect(html).not.toMatch(/Edge|Chrome|Firefox|Safari/);
  });

  it('renders nothing before the probe has run', () => {
    expect(renderToString(<SlowScriptNotice />)).toBe('');
  });
});

describe('ZoomMenu & ViewerInfoPanel', () => {
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
