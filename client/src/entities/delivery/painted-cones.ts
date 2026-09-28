import type { EvictView } from './evict-candidate';

/** Past entries kept at most; beyond it the two oldest merge, so no cone is ever dropped. */
const MAX_PAST = 16;

interface Past {
  view: EvictView;
  /** The latest MIRADA this entry covers. */
  seq: number;
  /** primera_entrega of the first plan for a later MIRADA; null until that PLAN INICIO. */
  until: number | null;
}

/**
 * A view whose cone contains the cones of both: the bounding box of the rectangles and the finer
 * focus. Each ring F_j scales the box around its own centre, and a box containing another
 * still contains it scaled by the same factor ≥ 1, so every cone test is a superset.
 */
function union(a: EvictView, b: EvictView): EvictView {
  return {
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    focus: Math.min(a.focus, b.focus),
  };
}

function merge(a: Past, b: Past): Past {
  const until = a.until === null || b.until === null ? null : Math.max(a.until, b.until);
  return { view: union(a.view, b.view), seq: Math.max(a.seq, b.seq), until };
}

/**
 * The views whose cones the server may still be painting. A new MIRADA replaces the plan, but
 * flows already opened for the old one keep coming (spec 4.1.3), so a past view stays until a
 * plan for a later MIRADA started (PLAN INICIO, seq_mirada above its seq) and every delivery
 * numbered below that plan's primera_entrega is settled. Evicting a parent in one of these
 * cones would get its child refused on arrival (spec 5.4). A drag reports a view every frame:
 * views no plan has answered yet share one merged entry, so the list stays short.
 */
export class PaintedCones {
  private current: { view: EvictView; seq: number } | null = null;
  private past: Past[] = [];

  /** The view the MIRADA numbered `seq` described. */
  look(view: EvictView, seq: number): void {
    if (this.current) {
      const left: Past = { ...this.current, until: null };
      const last = this.past[this.past.length - 1];
      if (last && last.until === null) this.past[this.past.length - 1] = merge(last, left);
      else this.past.push(left);
      if (this.past.length > MAX_PAST) this.past.splice(0, 2, merge(this.past[0]!, this.past[1]!));
    }
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
