import { useMemo, useRef, useState } from 'react';
import { ViewerChrome, type ViewSync } from '@/widgets/viewer-canvas';
import { ViewerToolbar } from '@/widgets/viewer-toolbar';
import { ViewerMinimap } from '@/widgets/viewer-minimap';
import { RenderSettingsPanel, TelemetryPanel, ViewerInfoPanel } from '@/widgets/viewer-panels';
import { ViewerTopBar } from '@/widgets/viewer-top-bar';
import { LiveStatusPill } from '@/widgets/viewer-status';
import { grantOf } from '@/features/cap-brushes';
import { buildPresets } from '@/features/zoom-view';
import { serverLoadLabel } from '@/entities/session';
import { sameReadout, sameViewRect, type ChromeApi, type PixelReadout, type ViewRect } from '@/entities/viewport';
import { useSeurat } from '@/app/providers/SeuratProvider';
import { useUi } from '@/app/store';
import { counterLabel } from '@/features/navigate-work';
import { fmtPct } from '@/shared/lib/zoom';
import { createFeed } from '@/shared/lib/feed';
import { POINTILLIST_ZOOM_THRESHOLD_PCT, VIEWER_FIT_ZOOM_HEADROOM, VIEWER_MAX_ZOOM } from '@/shared/config/view';
import { useViewerWork } from './useViewerWork';
import { useViewerControls } from './useViewerControls';
import { ViewerNotices } from './ViewerNotices';
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

  const effectiveMaxZoom = Math.max(VIEWER_MAX_ZOOM, Math.ceil((fitPct / 100) * VIEWER_FIT_ZOOM_HEADROOM));

  const presets = useMemo(
    () => buildPresets(pct, fitPct, effectiveMaxZoom, POINTILLIST_ZOOM_THRESHOLD_PCT / 100),
    [pct, fitPct, effectiveMaxZoom],
  );
  const workTag = seurat.works[idx]?.tag;
  const rows = useMemo(
    () => buildViewerInfoRows(dims, mp, iw, ih, fitPct, seurat.status, serverLoadLabel(seurat.regulation), workTag),
    [dims, mp, iw, ih, fitPct, seurat.status, seurat.regulation, workTag],
  );

  const ctl = useViewerControls({ ui, seurat, api, view, go, back });

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
          onToggleLoupe: ctl.toggleLoupe,
          onDiveDots: ctl.diveDots,
          onToggleInfo: ctl.toggleInfo,
          onToggleTelemetry: ctl.toggleTelemetry,
          onToggleSettings: ctl.toggleSettings,
          onPrev: ctl.prev,
          onNext: ctl.next,
          onBack: ctl.back,
          onCloseMenu: ctl.closeMenu,
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
        onBack={ctl.back}
        onPrev={ctl.prev}
        onNext={ctl.next}
        onToggleInfo={ctl.toggleInfo}
        onToggleTelemetry={ctl.toggleTelemetry}
        onToggleSettings={ctl.toggleSettings}
      />
      <ViewerNotices
        inDots={inDots}
        s={view?.s ?? 1}
        loading={loading}
        title={title}
        dims={dims}
        err={err}
        regulation={seurat.regulation}
        onRetry={retry}
      />
      <LiveStatusPill feed={feeds.readout} />
      <ViewerToolbar
        pctLabel={fmtPct(pct)}
        frac={frac}
        menu={ui.menu}
        presets={presets}
        loupe={ui.loupe}
        dots={inDots}
        onZoomIn={ctl.zoomIn}
        onZoomOut={ctl.zoomOut}
        onSlide={ctl.slide}
        onToggleMenu={ctl.toggleMenu}
        onPreset={ctl.preset}
        onFit={ctl.fit}
        onOneToOne={ctl.oneToOne}
        onToggleLoupe={ctl.toggleLoupe}
        onDiveDots={ctl.diveDots}
      />
      <ViewerMinimap api={api} feed={feeds.view} iw={iw} ih={ih} ready={ready} sink={seurat.sink} paintTick={seurat.paintTick} />
      {ui.info && <ViewerInfoPanel rows={rows} onClose={ctl.closeInfo} />}
      {ui.settings && <RenderSettingsPanel
          onClose={ctl.closeSettings}
          size={feeds.view}
          grant={grantOf(seurat.concession?.maxBrushes, seurat.welcome?.sessionMaxBrushes)}
        />}
      {ui.telemetry && <TelemetryPanel read={ctl.readTelemetry} onClose={ctl.closeTelemetry} />}
    </div>
  );
}
