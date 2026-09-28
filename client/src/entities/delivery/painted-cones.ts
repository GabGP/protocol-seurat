import type { EvictView } from './evict-candidate';

/** Past views kept at most: a bound on memory, reached only if PLAN INICIO stops coming. */
const MAX_PAST = 16;

interface Past {
  view: EvictView;
  seq: number;
  /** primera_entrega of the first plan for a later MIRADA; null until that PLAN INICIO. */
  until: number | null;
}

/**
 * The views whose cones the server may still be painting. A new MIRADA replaces the plan, but
 * flows already opened for the old one keep coming (spec 4.1.3), so a past view stays until a
 * plan for a later MIRADA started (PLAN INICIO, seq_mirada above its seq) and every delivery
 * numbered below that plan's primera_entrega is settled. Evicting a parent in one of these
 * cones would get its child refused on arrival (spec 5.4).
 */
export class PaintedCones {
  private current: { view: EvictView; seq: number } | null = null;
  private past: Past[] = [];

  /** The view the MIRADA numbered `seq` described. */
  look(view: EvictView, seq: number): void {
    if (this.current) this.past.push({ ...this.current, until: null });
    if (this.past.length > MAX_PAST) this.past.shift();
    this.current = { view, seq };
  }

  /** PLAN INICIO for MIRADA `seq`: numbers from `first` on belong to it or to later ones. */
  planStart(seq: number, first: number): void {
    for (const p of this.past) if (p.until === null && p.seq < seq) p.until = first;
  }

  /** The current view, then each past one that may still have deliveries on the way. */
  views(settledBelow: (n: number) => boolean): EvictView[] {
    this.past = this.past.filter((p) => p.until === null || !settledBelow(p.until));
    return [...(this.current ? [this.current.view] : []), ...this.past.map((p) => p.view)];
  }
}
