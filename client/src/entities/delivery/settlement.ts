/**
 * Which delivery numbers of a canvas are settled (spec 4.2.4c): the server numbers
 * every flow it opens, 1, 2, 3…, and each one ends here as a FIN (applied or dropped)
 * or in PLAN CANCELADAS. RASPADO / INVENTARIO for hasta_entrega = N wait until every
 * number ≤ N is settled. After a resume the old connection's in-flight numbers never
 * arrive: unseen numbers below the next PLAN INICIO are settled by definition.
 */
export class Settlement {
  private seen = new Set<number>();
  /** Every number ≤ floor is settled. */
  private floor = 0;
  /** Resumed and no PLAN INICIO yet: every unseen number so far is gone with the old connection. */
  private resumed = false;

  /** A delivery arrived (whatever became of it) or was announced cancelled. */
  mark(n: number): void {
    if (n <= this.floor) return;
    this.seen.add(n);
    while (this.seen.delete(this.floor + 1)) this.floor += 1;
  }

  /** PLAN INICIO: numbers from `first` on belong to the new connection. */
  planStart(first: number): void {
    if (!this.resumed) return;
    this.resumed = false;
    this.floor = Math.max(this.floor, first - 1);
    for (const n of [...this.seen]) if (n <= this.floor) this.seen.delete(n);
    while (this.seen.delete(this.floor + 1)) this.floor += 1;
  }

  resume(): void {
    this.resumed = true;
  }

  /** held(n): the book still owns it (also settled). */
  settledThrough(through: number, held: (n: number) => boolean): boolean {
    if (this.resumed) return true;
    for (let n = this.floor + 1; n <= through; n++) {
      if (!this.seen.has(n) && !held(n)) return false;
    }
    return true;
  }

  /** No number below n is still on its way (so a missing parent will not arrive). */
  settledBelow(n: number, held: (m: number) => boolean): boolean {
    return this.settledThrough(n - 1, held);
  }
}
