import { afterEach, describe, expect, it } from 'vitest';
import { clearWorkPreviews, getWorkPreview, notePreviewWidth } from '@/entities/work';
import { PREVIEW_OPENS } from '@/shared/config/constants';
import { opened, recorder, seedDelivery, settle } from './preview-fixtures';

describe('PreviewManager pages', () => {
  afterEach(() => {
    clearWorkPreviews();
  });

  it('closes works from previous page when a new page is shown', async () => {
    notePreviewWidth(300);
    const { log, manager } = recorder();
    manager.show(['work-a', 'work-b']);
    manager.onWorkOpened('work-a', opened(101));
    manager.onDelivery(seedDelivery(101, 1, 300, 4));
    await settle();
    expect(getWorkPreview('work-a')).toBeDefined();

    manager.show(['work-c']);
    expect(log.closed).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
    expect(log.opened).toContain('work-c');
    manager.dispose();
  });

  it('closes a work still being opened when show no longer lists it', () => {
    notePreviewWidth(300);
    const { log, manager } = recorder();
    manager.show(['work-a']);
    manager.onWorkOpened('work-a', opened(101));
    manager.show(['work-b']);
    expect(log.closed).toContain(101);
    manager.dispose();
  });

  it('closes the second ABIERTA when a page is left and shown again before the first one arrives', () => {
    const { log, manager } = recorder();
    manager.show(['work-a']);
    manager.show([]);
    manager.show(['work-a']);
    expect(log.opened).toEqual(['work-a', 'work-a']);
    manager.onWorkOpened('work-a', opened(101));
    manager.onWorkOpened('work-a', opened(102));
    expect(log.closed).toEqual([102]);
    manager.dispose();
  });

  it('does not open a queued id that was never opened after show drops it', () => {
    const { log, manager } = recorder();
    const ids = Array.from({ length: PREVIEW_OPENS + 2 }, (_, i) => `work-${i}`);
    manager.show(ids);
    const queued = ids.slice(PREVIEW_OPENS);
    manager.show([...ids.slice(0, PREVIEW_OPENS), 'work-extra']);
    manager.onError(ids[0]!);
    expect(log.opened).toContain('work-extra');
    for (const id of queued) {
      expect(log.opened).not.toContain(id);
    }
    manager.dispose();
  });
});
