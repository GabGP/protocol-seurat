import { HEAT_DWELL_CAP_S, HEAT_HALF_LIFE_S } from '@/shared/config/constants';

/**
 * Attention heat per brush: seconds it spent on screen, decaying with HEAT_HALF_LIFE_S.
 * Dwell, not recency: a brush glanced at once stays cold, one studied for a while stays warm.
 */
export class AttentionHeat {
  private readonly heats = new Map<string, { h: number; t: number }>();

  warm(key: string, dwellS: number, nowS: number): void {
    const add = Math.min(Math.max(0, dwellS), HEAT_DWELL_CAP_S);
    if (add === 0) return;
    this.heats.set(key, { h: this.heat(key, nowS) + add, t: nowS });
  }

  heat(key: string, nowS: number): number {
    const e = this.heats.get(key);
    return e ? e.h * 0.5 ** (Math.max(0, nowS - e.t) / HEAT_HALF_LIFE_S) : 0;
  }

  /** Forget brushes no longer owned: a refetched brush starts cold. */
  prune(live: ReadonlySet<string>): void {
    for (const key of this.heats.keys()) if (!live.has(key)) this.heats.delete(key);
  }
}
