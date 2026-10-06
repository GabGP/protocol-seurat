import { RUNG_NORMAL } from '@/shared/config/constants';
import type { Regulation } from '@/shared/proto/messages';

/** Info-panel text for the server load: "Normal" when unregulated. */
export function serverLoadLabel(reg: Regulation | null): string {
  if (!reg) return 'Normal';
  const parts = [`Reduced (rung ${reg.rung} of ${RUNG_NORMAL})`];
  if (reg.budgetKibS !== 0) {
    parts.push(`${reg.budgetKibS.toLocaleString('en-US')} KiB/s`);
  }
  parts.push(`${reg.sessions} ${reg.sessions === 1 ? 'viewer' : 'viewers'}`);
  return parts.join(' · ');
}
