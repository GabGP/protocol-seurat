export function stepIndex(idx: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return (((idx + delta) % n) + n) % n;
}

export function counterLabel(idx: number, n: number): string {
  return idx + 1 + ' / ' + n;
}

/** Tells when the open work leaves the catalog: true once it was listed and no longer is (OBRA BAJA). */
export function withdrawalWatch(): (listed: boolean) => boolean {
  let was = false;
  return (listed) => {
    if (listed) was = true;
    return was && !listed;
  };
}
