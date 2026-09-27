import { decodeSeed } from '@/shared/codec/seed';
import { parseBrushHead, sliceBands } from '@/shared/proto/brush';
import { dropWorkPreview, hasWorkPreview, setWorkPreview } from '@/entities/work/previews';
import { matchesScrape } from '@/entities/delivery/scrape';
import { LEASE_S, SEED_STRATUM } from '@/shared/config/constants';
import type { Audit, Renew, Scrape, WorkOpened } from '@/shared/proto/messages';
import type { SessionClient } from '@/app/providers/session-client';

/** A gallery thumbnail is a held seed: its canvas stays open, with its lease, while it is shown. */
interface Preview {
  id: string;
  handle: number;
  w: number;
  h: number;
  /** Delivery number of the seed once it arrived (0 before). */
  seed: number;
  expires: number;
  renewThrough: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const SOLTAR_LRU = 1;
const SOLTAR_CADUCADA = 3;
const OPEN_TIMEOUT_MS = 5000;

/**
 * Catalog thumbnails from the seed (spec 3.2), inside the protocol: the seed is a loan
 * like any other. RECIBO libre = 0 keeps the rest of the sketch from being painted;
 * anything else that arrives is released at once. RENOVAR / RASPAR / AUDITAR are
 * answered; CERRAR (leaving the gallery) or an unrenewed lease drops the thumbnail.
 */
export class PreviewManager {
  private queue: string[] = [];
  private loading: Preview | null = null;
  private held = new Map<number, Preview>();
  private paused = false;

  constructor(private client: () => SessionClient | null) {}

  enqueue(ids: string[]): void {
    for (const id of ids) {
      if (!hasWorkPreview(id) && !this.queue.includes(id) && this.loading?.id !== id) this.queue.push(id);
    }
    const order = new Map(ids.map((id, i) => [id, i]));
    this.queue.sort((a, b) => (order.get(a) ?? 9999) - (order.get(b) ?? 9999));
    this.pump();
  }

  /** A work is opened for viewing: every preview canvas is closed (CERRAR releases all of it). */
  pause(): void {
    this.paused = true;
    const all = [...this.held.values(), ...(this.loading ? [this.loading] : [])];
    this.loading = null;
    this.held.clear();
    for (const p of all) this.close(p);
    // Back in the gallery, the same thumbnails are fetched again (16 KB seeds, not kept meanwhile).
    this.queue = [...new Set([...all.map((p) => p.id), ...this.queue])];
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  owns(handle: number): boolean {
    return this.held.has(handle) || this.loading?.handle === handle;
  }

  onWorkOpened(id: string, a: WorkOpened): void {
    if (!this.loading || this.loading.id !== id) {
      this.client()?.closeHandle(a.handle);
      return;
    }
    this.loading.handle = a.handle;
    this.loading.w = a.seedWidth;
    this.loading.h = a.seedHeight;
  }

  onDelivery(bytes: Uint8Array): boolean {
    let h;
    try {
      h = parseBrushHead(bytes);
    } catch {
      return false;
    }
    const p = this.loading?.handle === h.handle ? this.loading : this.held.get(h.handle);
    if (!p) return false;
    if (p !== this.loading || h.stratum !== SEED_STRATUM) {
      this.client()?.sendRelease(h.handle, SOLTAR_LRU, [h.delivery]); // not a thumbnail: not kept
      return true;
    }
    if (p.timer) clearTimeout(p.timer);
    p.seed = h.delivery;
    p.expires = performance.now() + LEASE_S * 1000;
    this.loading = null;
    this.held.set(p.handle, p);
    this.client()?.sendReceipt(p.handle, [h.delivery], 0, 0, 0); // libre = 0: nothing more, please
    void (async () => {
      try {
        const band0 = sliceBands(bytes, h)[0];
        if (band0 && this.held.get(p.handle) === p) setWorkPreview(p.id, await decodeSeed(band0, p.w, p.h));
      } catch (err) {
        console.warn('Preview decode error for', p.id, err);
      } finally {
        this.pump();
      }
    })();
    return true;
  }

  onRenew(r: Renew): boolean {
    const p = this.held.get(r.handle);
    if (!p) return false;
    if (r.ranges.includes(p.seed)) p.expires = performance.now() + r.leaseS * 1000;
    p.renewThrough = Math.max(p.renewThrough, r.order);
    this.client()?.sendReceipt(p.handle, [], 0, 0, p.renewThrough);
    return true;
  }

  onScrape(r: Scrape): boolean {
    const p = this.held.get(r.handle) ?? (this.loading?.handle === r.handle ? this.loading : undefined);
    if (!p) return false;
    const seedRec = { delivery: p.seed, brushId: 10n << 56n, stratum: SEED_STRATUM, from: 0, through: 1,
      bytes: 0, epoch: 0, edition: 0, expires: 0, rgba: null };
    const scraped = p.seed > 0 && p.seed <= r.through && matchesScrape(seedRec, r.predicate, r.params);
    if (scraped) this.forget(p);
    const kept = p.seed > 0 && p.seed <= r.through && !scraped ? [p.seed] : [];
    this.client()?.sendScraped(r.handle, r.order, r.epoch, r.through, scraped ? 1 : 0, 0, kept);
    return true;
  }

  onAudit(a: Audit): boolean {
    const p = this.held.get(a.handle);
    if (!p) return false;
    const ranges = p.seed > 0 && p.seed <= a.through ? [p.seed] : [];
    this.client()?.sendInventory(a.handle, a.order, a.through, ranges.length, 0, ranges);
    return true;
  }

  /** Spec 5.2.2: a thumbnail whose lease ran out is dropped and released (SOLTAR CADUCADA). */
  sweep(now: number): void {
    for (const p of [...this.held.values()]) {
      if (p.seed > 0 && p.expires <= now) {
        this.client()?.sendRelease(p.handle, SOLTAR_CADUCADA, [p.seed]);
        this.forget(p);
        this.close(p);
      }
    }
  }

  onError(id: string): void {
    if (this.loading?.id === id) {
      if (this.loading.timer) clearTimeout(this.loading.timer);
      this.close(this.loading);
      this.loading = null;
      this.pump();
    }
  }

  private forget(p: Preview): void {
    dropWorkPreview(p.id);
    p.seed = 0;
  }

  private close(p: Preview): void {
    if (p.timer) clearTimeout(p.timer);
    this.held.delete(p.handle);
    dropWorkPreview(p.id);
    if (p.handle > 0) this.client()?.closeHandle(p.handle);
  }

  private pump(): void {
    if (this.paused || this.loading !== null) return;
    const nextId = this.queue.shift();
    if (!nextId) return;
    if (hasWorkPreview(nextId)) {
      this.pump();
      return;
    }
    const p: Preview = { id: nextId, handle: 0, w: 192, h: 160, seed: 0, expires: 0, renewThrough: 0, timer: null };
    p.timer = setTimeout(() => {
      if (this.loading === p) {
        this.close(p);
        this.loading = null;
        this.pump();
      }
    }, OPEN_TIMEOUT_MS);
    this.loading = p;
    this.client()?.openPreview(nextId);
  }

  dispose(): void {
    this.pause();
    this.queue = [];
  }
}
