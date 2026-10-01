import { describe, expect, it, vi } from 'vitest';
import type { Work } from '@/entities/work';
import { showPreviews } from '../providers/seurat/preview-cards';
import type { Runtime } from '../providers/seurat/runtime';

describe('showPreviews', () => {
  it('updates previewIds and forwards openable works to preview.show', () => {
    const show = vi.fn();
    const preview = { show } as unknown as Runtime['preview'];
    const works = new Map<string, Work>([
      ['w1', { id: 'w1', name: 'Openable 1', width: 10, height: 10, strata: 1, state: 3, edition: 1, progress: 100 }],
      ['w2', { id: 'w2', name: 'Not openable', width: 10, height: 10, strata: 1, state: 0, edition: 0, progress: 0 }],
      ['w3', { id: 'w3', name: 'Openable 2', width: 10, height: 10, strata: 1, state: 1, edition: 1, progress: 50 }],
    ]);
    const rt = {
      previewIds: [],
      works,
      preview,
    } as unknown as Runtime;

    showPreviews(rt, ['w1', 'w2', 'w3', 'w4']);

    expect(rt.previewIds).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(show).toHaveBeenCalledWith(['w1', 'w3']);
  });

  it('defaults to existing rt.previewIds when ids argument is omitted', () => {
    const show = vi.fn();
    const preview = { show } as unknown as Runtime['preview'];
    const works = new Map<string, Work>([
      ['w1', { id: 'w1', name: 'Openable 1', width: 10, height: 10, strata: 1, state: 3, edition: 1, progress: 100 }],
    ]);
    const rt = {
      previewIds: ['w1'],
      works,
      preview,
    } as unknown as Runtime;

    showPreviews(rt);

    expect(show).toHaveBeenCalledWith(['w1']);
  });

  it('handles null preview gracefully', () => {
    const rt = {
      previewIds: [],
      works: new Map<string, Work>(),
      preview: null,
    } as unknown as Runtime;

    expect(() => showPreviews(rt, ['w1'])).not.toThrow();
    expect(rt.previewIds).toEqual(['w1']);
  });
});
