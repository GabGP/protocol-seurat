/** One cached parent: full YCoCg planes ready to predict a child from. */
export interface PlaneSet {
  Y: Int16Array;
  Co: Int16Array;
  Cg: Int16Array;
}

/** Channel order of the transferred plane buffers and of the band details. */
export const PLANE_CHANNELS = ['Y', 'Co', 'Cg'] as const;

const MAX_FREQ = 3;

/**
 * S3-FIFO over parent planes: a tiny probationary queue, a main queue, and a
 * ghost history of evicted keys. Scan-resistant (a pan sweep admits once and
 * evicts without touching hot parents), nearly stateless, and LRU-free.
 * Hits only bump a capped frequency; movement happens lazily at eviction.
 */
export class ParentPlaneCache {
  private readonly small: string[] = [];
  private readonly main: string[] = [];
  private readonly ghost: string[] = [];
  private readonly planes = new Map<string, PlaneSet>();
  private readonly freq = new Map<string, number>();

  constructor(
    private readonly smallCap: number,
    private readonly mainCap: number,
    private readonly ghostCap: number,
  ) {}

  get size(): number {
    return this.planes.size;
  }

  has(key: string): boolean {
    return this.planes.has(key);
  }

  /** Touch-and-fetch: counts a visit, returns the planes. No reordering. */
  fetch(key: string): PlaneSet | undefined {
    const p = this.planes.get(key);
    if (p !== undefined) this.visit(key);
    return p;
  }

  store(key: string, planes: PlaneSet): void {
    if (this.planes.has(key)) {
      this.planes.set(key, planes);
      this.visit(key);
      return;
    }
    // Re-reference after eviction: admit straight to main.
    const toMain = this.ghost.includes(key);
    this.dropGhost(key);
    if (toMain) {
      this.evictMain();
      this.main.push(key);
    } else {
      this.evictSmall();
      this.small.push(key);
    }
    this.planes.set(key, planes);
    this.freq.set(key, 0);
  }

  private evictSmall(): void {
    while (this.small.length >= this.smallCap) {
      const key = this.small.shift();
      if (key === undefined) return;
      if ((this.freq.get(key) ?? 0) === 0) {
        this.evict(key);
        this.ghost.push(key);
        while (this.ghost.length > this.ghostCap) this.ghost.shift();
        return;
      }
      this.evictMain();
      this.main.push(key);
    }
  }

  private evictMain(): void {
    while (this.main.length >= this.mainCap) {
      const key = this.main.shift();
      if (key === undefined) return;
      const f = this.freq.get(key) ?? 0;
      if (f === 0) {
        this.evict(key);
        return;
      }
      this.freq.set(key, f - 1);
      this.main.push(key);
    }
  }

  private evict(key: string): void {
    this.planes.delete(key);
    this.freq.delete(key);
  }

  private dropGhost(key: string): void {
    const i = this.ghost.indexOf(key);
    if (i >= 0) this.ghost.splice(i, 1);
  }

  private visit(key: string): void {
    this.freq.set(key, Math.min(MAX_FREQ, (this.freq.get(key) ?? 0) + 1));
  }
}
