/** Why a delivery left the book here. */
export type Departure = 'evicted' | 'expired' | 'scraped' | 'cancelled' | 'failed synthesis' | 'replaced';

/** Departures remembered: enough to cover what is on the wire, bounded so it never grows. */
const KEPT = 1024;

export interface Departed {
  why: Departure;
  delivery: number;
  at: number;
  held: number;
  max: number;
}

/**
 * The last departure of each brush + edition (first noted, first forgotten past the bound), so
 * a refusal on arrival (spec 5.4) can say whether the missing parent was dropped here first (a
 * race with flows already on the wire) or never came (a server fault).
 */
export class Departures {
  private log = new Map<string, Departed>();

  note(key: string, why: Departure, delivery: number, at: number, held: number, max: number): void {
    this.log.set(key, { why, delivery, at, held, max });
    if (this.log.size > KEPT) this.log.delete(this.log.keys().next().value!);
  }

  /** The last departure of this brush + edition, if still remembered. */
  last(key: string): Departed | undefined {
    return this.log.get(key);
  }

  /** Why the parent is not there with enough bands: the sentence a 'parent' refusal logs. */
  parentMissing(key: string, heldBands: number, needed: number, now: number): string {
    if (heldBands > 0) return `its parent holds ${heldBands} of the ${needed} bands needed, a server fault`;
    const d = this.last(key);
    if (!d) return 'its parent never arrived, a server fault';
    return `its parent (delivery ${d.delivery}) was ${d.why} here ${Math.round(now - d.at)} ms earlier, `
      + `with ${d.held} of ${d.max} brushes held`;
  }
}
