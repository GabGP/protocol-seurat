import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { LoadError, RegulationNotice, SlowScriptCard, SlowScriptNotice, StatusPill } from '../index';

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

describe('RegulationNotice', () => {
  it('renders nothing while the session is not regulated', () => {
    expect(renderToString(<RegulationNotice regulation={null} />)).toBe('');
  });

  it('tells the viewer the server is busy', () => {
    const html = renderToString(
      <RegulationNotice regulation={{ rung: 1, budgetKibS: 2048, capacityKibS: 0, sessions: 16 }} />,
    );
    expect(html).toContain('Server busy');
    expect(html).toContain('role="status"');
  });
});
