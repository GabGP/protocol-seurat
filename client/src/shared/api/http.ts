import { SESSION_PATH } from '../config/constants';

export interface SessionResponse {
  token: string;
  lienzo: string;
  respaldo: string;
  versiones: number[];
  lado: number;
  /** True when the browser runs on the server machine. */
  local?: boolean;
  /** SHA-256 (hex) of the certificate of the WebTransport listener; the viewer pins it. */
  huella?: string;
}

/** Spec 3.1: POST /sesion to obtain a single-use token and transport endpoints. */
export async function postSession(
  client: string,
  memMiB: number,
  transports: string[],
): Promise<SessionResponse> {
  const res = await fetch(SESSION_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ cliente: client, memMiB, transportes: transports }),
  });
  if (!res.ok) throw new Error('session http ' + res.status);
  const body = (await res.json()) as SessionResponse;
  if (typeof body.token !== 'string' || typeof body.lienzo !== 'string' || typeof body.respaldo !== 'string') {
    throw new Error('session: bad response');
  }
  return body;
}
