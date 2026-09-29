import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capChoices, grantOf } from '../model/cap-choices';

describe('max brushes options', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('navigator', { deviceMemory: 8 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists the four viewports with their caps when the grant allows them', () => {
    expect(capChoices(1024).map((c) => c.label)).toEqual(['720p · 181', '1080p · 362', '1440p · 512', '4K · 1024']);
  });

  it('shows min(option, grant): a browser granted 384 reads 181, 362, 384, 384', () => {
    expect(capChoices(384).map((c) => c.effective)).toEqual([181, 362, 384, 384]);
    expect(capChoices(384).map((c) => c.label)).toEqual(['720p · 181', '1080p · 362', '1440p · 384', '4K · 384']);
  });

  it('keeps the stored option apart from the effective number', () => {
    expect(capChoices(384).map((c) => c.cap)).toEqual([181, 362, 512, 1024]);
  });

  it('takes the grant from the concession, else from what the session declared (3 x mem_mib, capped by the session)', () => {
    expect(grantOf(300, 1024)).toBe(300);
    expect(grantOf(null, 1024)).toBe(768); // deviceMemory 8 declares 256 MiB
    expect(grantOf(undefined, 256)).toBe(256);
  });
});
