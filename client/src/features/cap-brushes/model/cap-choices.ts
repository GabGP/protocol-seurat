import { declareMemMib } from '@/entities/session';
import { BRUSH_CAP_AUTO, BRUSH_CAP_OPTIONS } from '@/shared/config/constants';
import { BRUSHES_PER_MEM_MIB, SESSION_MAX_BRUSHES } from '@/shared/config/session';

export interface CapChoice {
  /** The stored option (what Settings remembers). */
  cap: number;
  /** "720p · 181": the option with the brushes this browser will really hold. */
  label: string;
  /** min(option, grant). */
  effective: number;
}

/**
 * What the server grants this browser (spec 6.1: min(3 x mem_mib, session ceiling)): the open work's concession when
 * there is one, else the same formula from what this session declared.
 */
export function grantOf(conceded: number | null | undefined, sessionMax: number | null | undefined): number {
  return conceded ?? Math.min(BRUSHES_PER_MEM_MIB * declareMemMib(), sessionMax ?? SESSION_MAX_BRUSHES);
}

/** The Settings options, each showing its effective number: a cap above the grant cannot hold more than the grant. "Auto" comes first and sizes itself to the screen. */
export function capChoices(grant: number, auto: number): CapChoice[] {
  const fixed = BRUSH_CAP_OPTIONS.map((o) => {
    const effective = Math.min(o.cap, grant);
    return { cap: o.cap, effective, label: `${o.label} · ${effective}` };
  });
  const effective = Math.min(auto, grant);
  return [{ cap: BRUSH_CAP_AUTO, effective, label: `Auto (${effective})` }, ...fixed];
}
