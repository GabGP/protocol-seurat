import type { SessionResponse } from '@/shared/api/http';

const ACCESS_KEY = 'seurat.accessKey';

/** Who this session is, as POST /sesion said: the account name (null = anonymous) and its role. */
export interface Account {
  name: string | null;
  role: string;
  local: boolean;
}

const ANONYMOUS_ROLE = 'anonimo';

export function accountOf(res: SessionResponse): Account {
  return { name: res.cuenta ?? null, role: res.rol ?? ANONYMOUS_ROLE, local: res.local === true };
}

/** The viewer account key POST /sesion sends as Bearer (spec 3.1); null = anonymous. */
export function loadAccessKey(): string | null {
  try {
    const k = localStorage.getItem(ACCESS_KEY);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/** Remembered in this browser until signed out; null forgets it. */
export function saveAccessKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(ACCESS_KEY, key.trim());
    else localStorage.removeItem(ACCESS_KEY);
  } catch {
    /* storage unavailable: the key lasts only for this page */
  }
}
