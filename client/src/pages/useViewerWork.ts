import { useEffect, useState, useRef } from 'react';
import type { SeuratState } from '@/app/providers/SeuratProvider';
import type { ViewSync } from '@/widgets/ViewerChrome';
import { goGallery, goViewer } from '@/app/router';
import { patchUi } from '@/app/store';
import { stepIndex } from '@/features/navigate-work';
import { isOpenable, workDims, workMp, workTitle } from '@/entities/work';
import { DEFAULT_WORK_WIDTH, DEFAULT_WORK_HEIGHT } from '@/shared/config/view';

export function useViewerWork(id: string, seurat: SeuratState) {
  const [attempt, setAttempt] = useState(0);
  const gazeInit = useRef(false);

  const viewable = seurat.works.filter(isOpenable);
  const list = viewable.length > 0 ? viewable : seurat.works;
  const idx = Math.max(0, list.findIndex((w) => w.id === id));
  const work = seurat.works.find((w) => w.id === id) ?? list[idx] ?? seurat.works[0];
  const n = list.length;
  const iw = work ? work.width : DEFAULT_WORK_WIDTH;
  const ih = work ? work.height : DEFAULT_WORK_HEIGHT;
  const title = work ? workTitle(work, idx) : 'Plate 01';
  const dims = work ? workDims(work) : '';
  const mp = work ? workMp(work) : '';

  useEffect(() => {
    gazeInit.current = false;
    if (seurat.client && seurat.welcome) {
      seurat.closeWork();
      seurat.client.openWork(id);
    }
    return () => {
      seurat.closeWork();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt, seurat.welcome]);

  useEffect(() => {
    const onVis = (): void => {
      if (document.visibilityState === 'hidden' && seurat.opened && seurat.gazeService) {
        seurat.gazeService.hidden(seurat.opened.handle);
      } else if (document.visibilityState === 'visible') {
        gazeInit.current = false;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [seurat.opened, seurat.gazeService]);

  useEffect(() => {
    if (seurat.opened && seurat.gazeService && !gazeInit.current) {
      gazeInit.current = true;
      seurat.gazeService.motion({
        handle: seurat.opened.handle,
        x0: 0,
        y0: 0,
        x1: iw,
        y1: ih,
        vw: typeof window !== 'undefined' ? Math.round(window.innerWidth) : 1920,
        vh: typeof window !== 'undefined' ? Math.round(window.innerHeight) : 1080,
        flags: 0,
      });
    }
  }, [seurat.opened, seurat.gazeService, iw, ih]);

  const err = seurat.lastError?.fatal === 1 || seurat.status.startsWith('offline');
  const loading = !err && (seurat.paintTick === 0 || !seurat.opened);
  const ready = !loading && !err;

  const retry = (): void => {
    setAttempt((a) => a + 1);
    seurat.retryConnect();
  };

  const go = (d: number): void => {
    const next = list[stepIndex(idx, d, n)];
    if (next) goViewer(next.id);
  };

  const back = (menuOpen: boolean, infoOpen: boolean, settingsOpen = false): void => {
    if (menuOpen) return patchUi({ menu: false });
    if (settingsOpen) return patchUi({ settings: false });
    if (infoOpen) return patchUi({ info: false });
    goGallery();
  };

  const onSyncMotion = (s: ViewSync): void => {
    if (!gazeInit.current && seurat.gazeService && seurat.opened) {
      gazeInit.current = true;
      seurat.gazeService.motion({
        handle: seurat.opened.handle,
        x0: 0, y0: 0, x1: iw, y1: ih,
        vw: Math.round(s.w), vh: Math.round(s.h), flags: 0,
      });
    }
  };

  return {
    idx, n, iw, ih, title, dims, mp, err, loading, ready, retry, go, back, onSyncMotion,
  };
}
