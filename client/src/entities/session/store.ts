import {
  CHROME_MEM_MIB, DEFAULT_MEM_MIB, HEARTBEAT_S, LEASE_S, MEM_MIB_PER_DEVICE_GIB, SESSION_MAX_BRUSHES, TICKET_BYTES, TILE, WIRE_FLOWS,
} from '@/shared/config/constants';
import { bytesToHex, hexToBytes } from '@/shared/lib/hex';

export interface SessionInfo {
  sessionId: bigint | null;
  ticket: Uint8Array | null;
  caps: number;
  leaseS: number;
  heartbeatS: number;
  maxInFlight: number;
  sessionMaxBrushes: number;
  lado: number;
}

export const EMPTY_SESSION: SessionInfo = {
  sessionId: null,
  ticket: null,
  caps: 0,
  leaseS: LEASE_S,
  heartbeatS: HEARTBEAT_S,
  maxInFlight: WIRE_FLOWS,
  sessionMaxBrushes: SESSION_MAX_BRUSHES,
  lado: TILE,
};

const TICKET_KEY = 'seurat.ticket';
const SESSION_KEY = 'seurat.session';

export function persistResume(sessionId: bigint, ticket: Uint8Array): void {
  try {
    sessionStorage.setItem(SESSION_KEY, sessionId.toString());
    sessionStorage.setItem(TICKET_KEY, bytesToHex(ticket));
  } catch {
    /* storage unavailable */
  }
}

export function loadResume(): { sessionId: bigint; ticket: Uint8Array } | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    const f = sessionStorage.getItem(TICKET_KEY);
    if (!s || !f || f.length !== TICKET_BYTES * 2) return null;
    return { sessionId: BigInt(s), ticket: hexToBytes(f) };
  } catch {
    return null;
  }
}

export function clearResume(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TICKET_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function declareMemMib(): number {
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof dm === 'number' && dm > 0) return Math.min(CHROME_MEM_MIB, Math.floor(dm * MEM_MIB_PER_DEVICE_GIB));
  return DEFAULT_MEM_MIB;
}
