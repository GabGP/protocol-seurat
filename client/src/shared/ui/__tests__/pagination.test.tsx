import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Pagination } from '../Pagination';

describe('Pagination component', () => {
  it('renders an empty string when count <= 1', () => {
    const html1 = renderToString(<Pagination page={0} count={1} onPage={() => {}} />);
    expect(html1).toBe('');

    const html0 = renderToString(<Pagination page={0} count={0} onPage={() => {}} />);
    expect(html0).toBe('');
  });

  it('renders pagination bar with disabled previous button and active page 1', () => {
    const html = renderToString(<Pagination page={0} count={3} onPage={() => {}} />);
    expect(html).toContain('aria-label="pagination"');
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Go to previous page"/);

    const occurrences = (html.match(/aria-current="page"/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*>1<\/button>/);
  });

  it('renders More pages twice for count 10 on page 5', () => {
    const html = renderToString(<Pagination page={5} count={10} onPage={() => {}} />);
    const morePagesCount = (html.match(/More pages/g) ?? []).length;
    expect(morePagesCount).toBe(2);
  });

  it('disables next button on the last page', () => {
    const html = renderToString(<Pagination page={2} count={3} onPage={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Go to next page"/);
  });
});
