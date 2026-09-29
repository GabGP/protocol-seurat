import { ownedDeliveries } from '@/entities/delivery';
import { PreviewManager } from '@/features/preview-works';
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '@/shared/config/constants';
import type { Runtime } from './runtime';

/** The two ends of a resume loop: `run` starts an attempt, `welcomed` says the server answered (BIENVENIDA). */
export interface Reconnect {
  run(): void;
  welcomed(): void;
}

/**
 * REANUDAR: a new POST /sesion + SALUDO that claims what the canvas still holds. A second trigger
 * (close, silence, pageshow, online, visible) waits for the attempt under way or replaces a pending
 * back-off; failures back off up to RECONNECT_MAX_MS, and only a BIENVENIDA resets that back-off.
 */
export function createReconnect(rt: Runtime): Reconnect {
  let retries = 0;
  let reconnecting = false;
  let pending: number | undefined;
  const run = (): void => {
    const client = rt.client;
    if (!rt.alive || reconnecting || !client) return;
    window.clearTimeout(pending);
    reconnecting = true;
    const sink = rt.sink;
    sink?.checkExpiry(performance.now()); // the claim is what is still held: nothing expired (spec 3.4.4)
    rt.resuming = sink?.handle ?? null;
    rt.preview?.dispose();
    rt.preview = new PreviewManager(() => rt.client);
    client.boot(sink ? [{ handle: sink.handle, ranges: ownedDeliveries(sink.book) }] : []).then(
      () => {
        reconnecting = false;
        client.requestCatalog();
      },
      () => {
        reconnecting = false;
        retries += 1;
        pending = window.setTimeout(run, Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retries));
      },
    );
  };
  return { run, welcomed: () => { retries = 0; } };
}
