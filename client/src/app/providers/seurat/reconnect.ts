import { ownedDeliveries } from '@/entities/delivery';
import { PreviewManager } from '@/features/preview-works';
import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '@/shared/config/constants';
import type { Runtime } from './runtime';

/**
 * REANUDAR: a new POST /sesion + SALUDO that claims what the canvas still holds. A second trigger
 * (close, pageshow) waits for the attempt under way; failures back off up to RECONNECT_MAX_MS.
 */
export function createReconnect(rt: Runtime): () => void {
  let retries = 0;
  let reconnecting = false;
  const reconnect = (): void => {
    const client = rt.client;
    if (!rt.alive || reconnecting || !client) return;
    reconnecting = true;
    const sink = rt.sink;
    sink?.checkExpiry(performance.now()); // the claim is what is still held: nothing expired (spec 3.4.4)
    rt.resuming = sink?.handle ?? null;
    rt.preview?.dispose();
    rt.preview = new PreviewManager(() => rt.client);
    client.boot(sink ? [{ handle: sink.handle, ranges: ownedDeliveries(sink.book) }] : []).then(
      () => {
        reconnecting = false;
        retries = 0;
        client.requestCatalog();
      },
      () => {
        reconnecting = false;
        retries += 1;
        window.setTimeout(reconnect, Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retries));
      },
    );
  };
  return reconnect;
}
