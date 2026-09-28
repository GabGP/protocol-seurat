import { CLIENT_NAME } from '@/shared/config/constants';
import { postSession, SessionAuthError } from '@/shared/api/http';
import { declareMemMib, clearResume } from '@/entities/session/store';
import { loadAccessKey, saveAccessKey } from '@/entities/session/access-key';

export type SignInResult = 'ok' | 'refused' | 'offline';

/**
 * Checks the key with POST /sesion (the unused token just expires, spec 3.1), remembers it,
 * and starts over: a role change is a new session (a resume is bound to its principal).
 */
export async function signIn(key: string, restart: () => void = reload): Promise<SignInResult> {
  try {
    await postSession(CLIENT_NAME, declareMemMib(), ['websocket'], key.trim());
  } catch (e) {
    return e instanceof SessionAuthError ? 'refused' : 'offline';
  }
  saveAccessKey(key);
  clearResume();
  restart();
  return 'ok';
}

export function signOut(restart: () => void = reload): void {
  saveAccessKey(null);
  clearResume();
  restart();
}

export function signedIn(): boolean {
  return loadAccessKey() !== null;
}

function reload(): void {
  window.location.reload();
}
