import { SessionClient } from '@/entities/session';
import { GazeSender } from '@/features/send-gaze';
import { PreviewManager } from '@/features/preview-works';
import { createReconnect } from './reconnect';
import type { Runtime } from './runtime';
import { createEvents } from './session-events';

const PREVIEW_SWEEP_MS = 1000;

function offline(e: unknown): string {
  return 'offline: ' + (e instanceof Error ? e.message : String(e));
}

/** Boot the first session and keep it alive; returns the teardown. */
export function startSession(rt: Runtime): () => void {
  rt.alive = true;
  rt.concession = null;
  rt.resuming = null;
  rt.preview = new PreviewManager(() => rt.client);
  const reconnect = createReconnect(rt);
  const client = new SessionClient(createEvents(rt, reconnect));
  rt.client = client;
  rt.gaze = new GazeSender(
    () => rt.client?.activeTransport ?? null,
    (m) => rt.sink?.handle === m.handle && rt.sink.setView(m.x0, m.y0, m.x1, m.y1, m.vw, m.vh, m.seq),
  );
  client.boot().then(
    () => {
      if (rt.alive) client.requestCatalog();
    },
    (e: unknown) => {
      if (rt.alive) rt.ui.setStatus(offline(e));
    },
  );
  // pagehide sends nothing (spec 5.3): the book survives L + delta and pageshow resumes it.
  // Back from the bfcache the connection is gone: REANUDAR claims what has not expired (none
  // of it after L, and then the canvas starts over from the sketch).
  const onPageShow = (e: PageTransitionEvent): void => {
    if (e.persisted && !client.connected && !client.failed) reconnect();
  };
  window.addEventListener('pageshow', onPageShow);
  // The viewer's leases are checked before each paint (ViewerChrome) and on every incoming message
  // (onIncoming). A gallery thumbnail is painted once and stays on screen, so it is also dropped
  // when its lease ends even if the connection has gone quiet (spec 5.2.2).
  const sweep = window.setInterval(() => rt.preview?.sweep(performance.now()), PREVIEW_SWEEP_MS);
  return () => {
    rt.alive = false;
    window.removeEventListener('pageshow', onPageShow);
    rt.bumpPaint.cancel();
    window.clearInterval(sweep);
    rt.gaze?.dispose();
    rt.preview?.dispose();
    rt.preview = null;
    rt.sink?.dispose();
    client.dispose();
    rt.client = null;
  };
}
