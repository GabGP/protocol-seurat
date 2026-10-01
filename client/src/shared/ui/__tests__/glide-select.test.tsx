import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { GlideSelect } from '../GlideSelect';

describe('GlideSelect component', () => {
  const choices = [
    { value: 1, label: 'One' },
    { value: 2, label: 'Two' },
    { value: 3, label: 'Three' },
  ];

  it('renders closed combobox with attributes and selected label', () => {
    const html = renderToString(<GlideSelect label="Pick" choices={choices} value={2} onChange={() => {}} />);
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Pick"');
    expect(html).toContain('Two');
  });

  it('contains no listbox and no option when closed', () => {
    const html = renderToString(<GlideSelect label="Pick" choices={choices} value={2} onChange={() => {}} />);
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="option"');
  });

  it('renders combobox and none of the labels when value matches no choice', () => {
    const html = renderToString(<GlideSelect label="Pick" choices={choices} value={99} onChange={() => {}} />);
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('One');
    expect(html).not.toContain('Two');
    expect(html).not.toContain('Three');
  });
});
