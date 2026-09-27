import { useMemo, useRef, useState } from 'react';
import {
  ViewerChrome, sameReadout, sameViewRect, type ChromeApi, type PixelReadout, type ViewRect, type ViewSync,
} from '@/widgets/ViewerChrome';
import { ViewerToolbar } from '@/widgets/ViewerToolbar';
import { ViewerMinimap } from '@/widgets/ViewerMinimap';
import { ViewerInfoPanel } from '@/widgets/ViewerInfoPanel';
import { TelemetryPanel } from '@/widgets/TelemetryPanel';
import { RenderSettingsPanel } from '@/widgets/RenderSettingsPanel';
import type { TelemetryInput } from '@/entities/telemetry/sections';
import { ViewerTopBar } from '@/widgets/ViewerTopBar';
import { LiveStatusPill } from '@/widgets/StatusPill';
import { LoadError } from '@/widgets/LoadError';
import { buildPresets } from '@/widgets/ZoomMenu';
import { useSeurat } from '@/app/providers/SeuratProvider';
import { patchUi, useUi } from '@/app/store';
import { counterLabel } from '@/features/navigate-work';
import { fmtPct } from '@/shared/lib/zoom';
import { dotsPerSide } from '@/widgets/pointillism';
import { Icon } from '@/shared/ui/Icon';
import { createFeed } from '@/shared/lib/feed';
import {
  POINTILLIST_ZOOM_THRESHOLD_PCT,
  VIEWER_MAX_ZOOM,
  POINTILLIST_AUTO_ZOOM,
  ZOOM_STEP_FACTOR,
} from '@/shared/config/view';
import { useViewerWork } from './useViewerWork';
import { buildViewerInfoRows } from './viewerInfoRows';
import styles from './ViewerPage.module.css';

export function ViewerPage({ id }: { id: string }): JSX.Element {
  const ui = useUi();
  const seurat = useSeurat();
  const [view, setView] = useState<ViewSync | null>(null);
  const api = useRef<ChromeApi | null>(null);
  // Frame-rate channels: the canvas publishes, the minimap and the pill listen, this page does not.
  const feeds = useMemo(() => ({
    view: createFeed<ViewRect | null>(null, sameViewRect),
    readout: createFeed<PixelReadout | null>(null, sameReadout),
  }), []);

  const { idx, n, iw, ih, title, dims, mp, err, loading, ready, retry, go, back, onSyncMotion } =
    useViewerWork(id, seurat);

  const pct = view?.pct ?? 100;
  const frac = view?.frac ?? 0;
  const fitPct = view?.fitPct ?? 100;
  const inDots = view?.inDots ?? false;

  const effectiveMaxZoom = Math.max(VIEWER_MAX_ZOOM, Math.ceil((fitPct / 100) * 4));

  const presets = useMemo(
    () => buildPresets(pct, fitPct, effectiveMaxZoom, POINTILLIST_ZOOM_THRESHOLD_PCT / 100),
    [pct, fitPct, effectiveMaxZoom],
  );
  const workTag = seurat.works[idx]?.tag;
  const rows = useMemo(
    () => buildViewerInfoRows(dims, mp, iw, ih, fitPct, seurat.status, workTag),
    [dims, mp, iw, ih, fitPct, seurat.status, workTag],
  );

  const handleBack = (): void => back(ui.menu, ui.info, ui.settings);
  const toggleTelemetry = (): void => patchUi({ telemetry: !ui.telemetry });
  // Details and settings share the right-hand slot: opening one closes the other.
  const toggleInfo = (): void => patchUi({ info: !ui.info, settings: false });
  const toggleSettings = (): void => patchUi({ settings: !ui.settings, info: false });
  const readTelemetry = (): TelemetryInput => ({
    now: performance.now(),
    transport: seurat.client?.activeTransport?.name ?? null,
    link: seurat.client?.meter ?? null,
    image: seurat.telemetry,
    sink: seurat.sink,
    concession: seurat.concession,
  });
  // Dots are the view itself, never switched off: the button only dives into them.
  const handleDiveDots = (): void => {
    if ((view?.s ?? 1) < POINTILLIST_ZOOM_THRESHOLD_PCT / 100) api.current?.zoomTo(POINTILLIST_AUTO_ZOOM);
  };

  return (
    <div className={styles.container}>
      <ViewerChrome
        iw={iw}
        ih={ih}
        handle={seurat.opened?.handle ?? 0}
        sink={seurat.sink}
        paintTick={seurat.paintTick}
        gazeService={seurat.gazeService}
        loupe={ui.loupe}
        dotThreshold={POINTILLIST_ZOOM_THRESHOLD_PCT}
        maxZoom={effectiveMaxZoom}
        apiRef={api}
        actions={{
          onToggleLoupe: () => patchUi({ loupe: !ui.loupe }),
          onDiveDots: handleDiveDots,
          onToggleInfo: toggleInfo,
          onToggleTelemetry: toggleTelemetry,
          onToggleSettings: toggleSettings,
          onPrev: () => go(-1),
          onNext: () => go(1),
          onBack: handleBack,
          onCloseMenu: () => { if (ui.menu) patchUi({ menu: false }); },
        }}
        onSync={(s) => {
          setView(s);
          onSyncMotion(s);
        }}
        viewFeed={feeds.view}
        readoutFeed={feeds.readout}
      />
      <ViewerTopBar
        title={title}
        dims={dims}
        mp={mp}
        counter={counterLabel(idx, n)}
        infoActive={ui.info}
        telemetryActive={ui.telemetry}
        settingsActive={ui.settings}
        onBack={handleBack}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onToggleInfo={toggleInfo}
        onToggleTelemetry={toggleTelemetry}
        onToggleSettings={toggleSettings}
      />
      {inDots && (
        <div className={styles.pointillistBanner}>
          <Icon name="blur_on" size={20} />Pointillist view · each pixel = {dotsPerSide(view?.s ?? 1) ** 2} dots
        </div>
      )}
      {loading && (
        <div className={styles.loadingNotice}>Loading {title} · {dims} px</div>
      )}
      {err && <LoadError onRetry={retry} />}
      <LiveStatusPill feed={feeds.readout} />
      <ViewerToolbar
        pctLabel={fmtPct(pct)}
        frac={frac}
        menu={ui.menu}
        presets={presets}
        loupe={ui.loupe}
        dots={inDots}
        onZoomIn={() => api.current?.zoomTo((view?.s ?? 1) * ZOOM_STEP_FACTOR)}
        onZoomOut={() => api.current?.zoomTo((view?.s ?? 1) / ZOOM_STEP_FACTOR)}
        onSlide={(f) => api.current?.slideTo(f)}
        onToggleMenu={() => patchUi({ menu: !ui.menu })}
        onPreset={(p) => {
          if (p.zoom === null) api.current?.fit(false);
          else {
            api.current?.zoomTo(p.zoom / 100);
          }
          patchUi({ menu: false });
        }}
        onFit={() => api.current?.fit(false)}
        onOneToOne={() => api.current?.zoomTo(1)}
        onToggleLoupe={() => patchUi({ loupe: !ui.loupe })}
        onDiveDots={handleDiveDots}
      />
      <ViewerMinimap api={api} feed={feeds.view} iw={iw} ih={ih} ready={ready} sink={seurat.sink} paintTick={seurat.paintTick} />
      {ui.info && <ViewerInfoPanel rows={rows} onClose={() => patchUi({ info: false })} />}
      {ui.settings && <RenderSettingsPanel onClose={() => patchUi({ settings: false })} />}
      {ui.telemetry && <TelemetryPanel read={readTelemetry} onClose={() => patchUi({ telemetry: false })} />}
    </div>
  );
}
