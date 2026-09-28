import type { DecodedPlanes } from './preview-decoder';

/**
 * A loan's decoded brushes, kept between its composes: each is signed by the pieces it was
 * decoded from (its own bands and everything above it), and decoded again only when that
 * changes. A compose sweeps what it did not use, so nothing outlives what the card shows.
 */
export class BrushMemo {
  private readonly kept = new Map<string, { sig: string; planes: DecodedPlanes }>();
  private readonly used = new Set<string>();

  /** The planes kept for `key` under `sig`, or `decode`'s, then kept. */
  async get(key: string, sig: string, decode: () => Promise<DecodedPlanes>): Promise<DecodedPlanes> {
    this.used.add(key);
    const hit = this.kept.get(key);
    if (hit?.sig === sig) return hit.planes;
    const planes = await decode();
    this.kept.set(key, { sig, planes });
    return planes;
  }

  /** Drops every brush the last compose did not ask for (a stratum no longer shown). */
  sweep(): void {
    for (const key of this.kept.keys()) if (!this.used.has(key)) this.kept.delete(key);
    this.used.clear();
  }

  get size(): number {
    return this.kept.size;
  }
}
