import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OBRAS_PATH } from '@/shared/config/protocol';
import { deleteWork, renameWork, WorkEditError } from '../works';

describe('shared/api/works', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('renameWork', () => {
    it('sends PATCH with urlencoded id, Content-Type header, and new name body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', fetchMock);

      await renameWork('gallery piece/01 #2', 'New Title');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`${OBRAS_PATH}gallery%20piece%2F01%20%232`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: 'New Title',
      });
    });

    it('resolves on status 200', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(renameWork('art-1', 'Renamed')).resolves.toBeUndefined();
    });

    it.each([400, 403, 404, 500])('rejects with WorkEditError(%i) on status %i', async (status) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(renameWork('art-1', 'Renamed')).rejects.toSatisfy((err: unknown) => {
        return err instanceof WorkEditError && err.status === status;
      });
    });

    it('rejects with WorkEditError(0) on network failure', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('Network offline'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(renameWork('art-1', 'Renamed')).rejects.toSatisfy((err: unknown) => {
        return err instanceof WorkEditError && err.status === 0;
      });
    });
  });

  describe('deleteWork', () => {
    it('sends DELETE with urlencoded id containing space and slash', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', fetchMock);

      await deleteWork('sub/folder work #9');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(`${OBRAS_PATH}sub%2Ffolder%20work%20%239`, {
        method: 'DELETE',
      });
    });

    it('resolves on status 200', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(deleteWork('art-2')).resolves.toBeUndefined();
    });

    it.each([403, 404, 500])('rejects with WorkEditError(%i) on status %i', async (status) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(deleteWork('art-2')).rejects.toSatisfy((err: unknown) => {
        return err instanceof WorkEditError && err.status === status;
      });
    });

    it('rejects with WorkEditError(0) on network failure', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(deleteWork('art-2')).rejects.toSatisfy((err: unknown) => {
        return err instanceof WorkEditError && err.status === 0;
      });
    });
  });
});
