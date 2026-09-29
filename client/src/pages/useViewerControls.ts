import type { MutableRefObject } from 'react';
import type { ViewSync } from '@/widgets/viewer-canvas';
import type { ZoomPreset } from '@/features/zoom-view';
import type { ChromeApi } from '@/entities/viewport';
import type { TelemetryInput } from '@/entities/telemetry';
import type { SeuratState } from '@/app/providers/SeuratProvider';
import { declareMemMib } from '@/entities/session';
import { gpuBytes } from '@/shared/lib/gpu-meter';
import { tabMemory, tabMemorySupported } from '@/shared/lib/tab-memory';
import { patchUi, type UiState } from '@/app/store';
import { POINTILLIST_AUTO_ZOOM, POINTILLIST_ZOOM_THRESHOLD_PCT, ZOOM_STEP_FACTOR } from '@/shared/config/view';

interface Deps {
  ui: UiState;
  seurat: SeuratState;
  api: MutableRefObject<ChromeApi | null>;
  view: ViewSync | null;
  go: (delta: number) => void;
  back: (menu: boolean, info: boolean, settings: boolean) => void;
}

/** The one set of handlers the viewer's chrome, top bar and toolbar share (each used to build its own). */
export function useViewerControls({ ui, seurat, api, view, go, back }: Deps) {
  const s = view?.s ?? 1;
  const zoomTo = (target: number): void => api.current?.zoomTo(target);
  return {
    back: (): void => back(ui.menu, ui.info, ui.settings),
    prev: (): void => go(-1),
    next: (): void => go(1),
    toggleTelemetry: (): void => patchUi({ telemetry: !ui.telemetry }),
    // Details and settings share the right-hand slot: opening one closes the other.
    toggleInfo: (): void => patchUi({ info: !ui.info, settings: false }),
    toggleSettings: (): void => patchUi({ settings: !ui.settings, info: false }),
    toggleLoupe: (): void => patchUi({ loupe: !ui.loupe }),
    toggleMenu: (): void => patchUi({ menu: !ui.menu }),
    closeInfo: (): void => patchUi({ info: false }),
    closeSettings: (): void => patchUi({ settings: false }),
    closeTelemetry: (): void => patchUi({ telemetry: false }),
    closeMenu: (): void => { if (ui.menu) patchUi({ menu: false }); },
    zoomIn: (): void => zoomTo(s * ZOOM_STEP_FACTOR),
    zoomOut: (): void => zoomTo(s / ZOOM_STEP_FACTOR),
    slide: (f: number): void => api.current?.slideTo(f),
    fit: (): void => api.current?.fit(false),
    oneToOne: (): void => zoomTo(1),
    preset: (p: ZoomPreset): void => {
      if (p.zoom === null) api.current?.fit(false);
      else zoomTo(p.zoom / 100);
      patchUi({ menu: false });
    },
    // Dots are the view itself, never switched off: the button only dives into them.
    diveDots: (): void => {
      if (s < POINTILLIST_ZOOM_THRESHOLD_PCT / 100) zoomTo(POINTILLIST_AUTO_ZOOM);
    },
    readTelemetry: (): TelemetryInput => ({
      now: performance.now(),
      transport: seurat.client?.activeTransport?.name ?? null,
      link: seurat.client?.meter ?? null,
      image: seurat.telemetry,
      sink: seurat.sink,
      concession: seurat.concession,
      gpuBytes: gpuBytes(),
      tabMemory: tabMemorySupported() ? tabMemory() : undefined,
      declaredMemMiB: declareMemMib(),
    }),
  };
}
