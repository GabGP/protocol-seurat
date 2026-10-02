import { describe, expect, it } from 'vitest';
import { sessionInfoOf } from '../session-info';

describe('sessionInfoOf', () => {
  it('extracts local boolean when present', () => {
    const info = sessionInfoOf({
      token: 'tok',
      lienzo: 'ws://localhost/l',
      respaldo: 'ws://localhost/r',
      versiones: [1],
      lado: 256,
      local: true,
    });
    expect(info.local).toBe(true);
  });

  it('defaults local to false when absent', () => {
    const info = sessionInfoOf({
      token: 'tok',
      lienzo: 'ws://localhost/l',
      respaldo: 'ws://localhost/r',
      versiones: [1],
      lado: 256,
    });
    expect(info.local).toBe(false);
  });
});
