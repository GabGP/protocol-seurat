import { PRESET_MATCH_TOLERANCE, ZOOM_PRESET_TIERS } from '@/shared/config/view';
import { fmtPct } from '@/shared/lib/zoom';

export interface ZoomPreset {
  label: string;
  note: string;
  on: boolean;
  zoom: number | null;
}

const ACTUAL_PIXELS_PCT = 100;

/** The zoom menu's rows: the tiers this work can reach, the one matching the current zoom marked on. */
export function buildPresets(pct: number, fitPct: number, maxS: number, th: number): ZoomPreset[] {
  return ZOOM_PRESET_TIERS
    .filter((z) => z === null || z / 100 <= maxS)
    .map((z) => ({
      label: z === null ? 'Fit to screen' : z.toLocaleString('en-US') + '%',
      note: z === null ? fmtPct(fitPct) : z === ACTUAL_PIXELS_PCT ? 'Actual pixels' : z / 100 >= th ? 'Dots' : '',
      on: Math.abs(pct - (z === null ? fitPct : z)) < PRESET_MATCH_TOLERANCE,
      zoom: z,
    }));
}
