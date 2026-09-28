import { SESSION_PATH } from '../config/constants';

export interface SessionResponse {
  token: string;
  lienzo: string;
  respaldo: string;
  versiones: number[];
  lado: number;
  /** The role this session got: anonimo | autenticado | privilegiado. */
  rol?: string;
  /** The signed-in account's name; absent when anonymous. */
  cuenta?: string;
}

/** POST /sesion refused the Bearer key (401): the account does not exist. */
export class SessionAuthError extends Error {
  constructor() {
    super('session: access key refused');
  }
}

const UNAUTHORIZED = 401;

/** Spec 3.1: with `accessKey` the session is the account's (Bearer); without, anonymous (cookie). */
export async function postSession(
  client: string,
  memMiB: number,
  transports: string[],
  accessKey: string | null = null,
): Promise<SessionResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessKey) headers.Authorization = 'Bearer ' + accessKey;
  const res = await fetch(SESSION_PATH, {
    method: 'POST',
    headers,
    cache: 'no-store',
    body: JSON.stringify({ cliente: client, memMiB, transportes: transports }),
  });
  if (res.status === UNAUTHORIZED) throw new SessionAuthError();
  if (!res.ok) throw new Error('session http ' + res.status);
  const body = (await res.json()) as SessionResponse;
  if (typeof body.token !== 'string' || typeof body.lienzo !== 'string' || typeof body.respaldo !== 'string') {
    throw new Error('session: bad response');
  }
  return body;
}
