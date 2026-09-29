import { MEM_OVERRIDE_KEY } from '@/shared/config/session';

/** The memory (MiB) the user chose to declare in SALUDO, or null for the spec formula. */
export function loadMemOverride(): number | null {
  try {
    const n = Number(localStorage.getItem(MEM_OVERRIDE_KEY));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Remembered in this browser; null returns to the spec formula. Takes effect on the next session. */
export function saveMemOverride(mib: number | null): void {
  try {
    if (mib !== null && mib > 0) localStorage.setItem(MEM_OVERRIDE_KEY, String(Math.floor(mib)));
    else localStorage.removeItem(MEM_OVERRIDE_KEY);
  } catch {
    /* storage unavailable: the choice lasts only for this page */
  }
}
