import type { SessionResponse } from '@/shared/api/http';

/** What POST /sesion says about this browser (ADR-05: there are no roles or accounts). */
export interface SessionInfo {
  /** True when the browser runs on the server machine: the path-import tab shows (ADR-04). */
  local: boolean;
}

export function sessionInfoOf(res: SessionResponse): SessionInfo {
  return { local: res.local === true };
}
