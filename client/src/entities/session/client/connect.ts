import { postSession, type SessionResponse } from '@/shared/api/http';
import type { SeuratTransport } from '@/shared/api/transport';
import { WsTransport } from '@/shared/api/ws';
import { WtTransport } from '@/shared/api/wt';
import { CLIENT_NAME } from '@/shared/config/constants';

const TRANSPORTS = ['webtransport', 'websocket'];
const SECURE_SCHEME = 'https:';

/** POST /sesion to obtain a single-use token and transport endpoints. */
export async function authenticate(memMib: number): Promise<SessionResponse> {
  return postSession(CLIENT_NAME, memMib, TRANSPORTS);
}

/**
 * WebTransport when the URL is secure and the browser has it, else the WebSocket fallback.
 * `wire` is called with the transport before it is announced through `onStatus`.
 */
export async function connectTransport(
  url: string,
  fallbackUrl: string,
  wire: (t: SeuratTransport) => void,
  onStatus: (s: string) => void,
): Promise<SeuratTransport> {
  if (url.startsWith(SECURE_SCHEME) && WtTransport.supported()) {
    const wt = new WtTransport(url);
    try {
      await wt.connect();
      wire(wt);
      onStatus('webtransport');
      return wt;
    } catch {
      wt.close();
    }
  }
  const ws = new WsTransport(fallbackUrl);
  await ws.connect();
  wire(ws);
  onStatus('websocket');
  return ws;
}
