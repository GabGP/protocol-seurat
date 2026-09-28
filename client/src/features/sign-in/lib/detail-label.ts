/** Bands per brush in a full delivery (spec 2.1). */
const ALL_BANDS = 4;

/**
 * What this viewer's role may see on the open work, from ABIERTA's techo_estrato and
 * techo_bandas (spec 2.3): stratum s is 1/2^s of the native resolution; fewer bands, less detail.
 */
export function detailLabel(stratum: number, bands: number): string {
  if (stratum === 0 && bands >= ALL_BANDS) return 'Full quality (native pixels, all detail)';
  const res = stratum === 0 ? 'Native resolution' : `1/${2 ** stratum} resolution`;
  return `${res}, ${bands} of ${ALL_BANDS} detail bands`;
}

const ROLE_LABELS: Record<string, string> = {
  anonimo: 'Anonymous',
  autenticado: 'Authenticated',
  privilegiado: 'Privileged',
};

/** The role POST /sesion reported, in words (spec 2.3 role names). */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
