import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewManager } from '../model/preview-manager';
import { clearWorkPreviews, getWorkPreview } from '@/entities/work/previews';
import { scrapeParamsList, scrapeParamsLowStratum, type WorkOpened } from '@/shared/proto/messages';
import { LEASE_S } from '@/shared/config/constants';
import type { SessionClient } from '@/app/providers/session-client';
import { brushDelivery, inlineWorkers, seedDelivery, settle } from './preview-fixtures';

/** A 300 × 4 seed under a work of 11 strata: stratum 9 has 3 × 1 brushes under it. */
const opened = (handle: number, seedWidth = 300, seedHeight = 4, strata = 11): WorkOpened => ({
  handle, width: 76_800, height: 1024, strata, edition: 1, ceilingStratum: 10, ceilingBands: 4, seedWidth, seedHeight,
});

function recorder() {
  const log = {
    opened: [] as string[], closed: [] as number[], receipts: [] as Array<{ completed: number[]; free: number }>,
    released: [] as Array<{ reason: number; ranges: number[] }>, scraped: [] as number[][], inventory: [] as number[][],
  };
  const client = {
    openPreview: (id: string) => log.opened.push(id),
    closeHandle: (h: number) => log.closed.push(h),
    sendReceipt: (_h: number, completed: number[], _q: number, free: number) => log.receipts.push({ completed, free }),
    sendRelease: (_h: number, reason: number, ranges: number[]) => log.released.push({ reason, ranges }),
    sendScraped: (...a: unknown[]) => log.scraped.push(a[6] as number[]),
    sendInventory: (...a: unknown[]) => log.inventory.push(a[5] as number[]),
  } as unknown as SessionClient;
  return { log, manager: new PreviewManager(() => client, inlineWorkers) };
}

/** Opens work-a as handle 101 and delivers its seed and three stratum-9 brushes. */
async function fullPreview() {
  const r = recorder();
  r.manager.enqueue(['work-a', 'work-b']);
  r.manager.onWorkOpened('work-a', opened(101));
  r.manager.onDelivery(seedDelivery(101, 1, 300, 4));
  await settle();
  for (let bx = 0; bx < 3; bx++) r.manager.onDelivery(brushDelivery(101, 2 + bx, 9, bx, 0));
  await settle();
  return r;
}

describe('PreviewManager', () => {
  beforeEach(() => clearWorkPreviews());
  afterEach(() => vi.restoreAllMocks());

  it('shows the seed, then the stratum under it, asking for exactly the missing brushes', async () => {
    const { log, manager } = recorder();
    manager.enqueue(['work-a', 'work-b']);
    manager.onWorkOpened('work-a', opened(101));
    expect(manager.onDelivery(seedDelivery(101, 1, 300, 4))).toBe(true);
    await settle();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 });
    expect(log.opened).toEqual(['work-a', 'work-b']);

    for (let bx = 0; bx < 3; bx++) manager.onDelivery(brushDelivery(101, 2 + bx, 9, bx, 0));
    await settle();
    const img = getWorkPreview('work-a');
    expect(img).toMatchObject({ width: 600, height: 8 });
    expect(Array.from(img?.rgba.subarray(0, 4) ?? [])).toEqual([120, 140, 200, 255]);
    expect(log.receipts).toEqual([
      { completed: [1], free: 3 }, { completed: [2], free: 2 }, { completed: [3], free: 1 }, { completed: [4], free: 0 },
    ]);

    manager.dispose();
    expect(log.closed).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
  });

  it('releases anything that is not the seed or a new brush right under it', async () => {
    const { log, manager } = await fullPreview();
    manager.onDelivery(brushDelivery(101, 5, 8, 0, 0)); // deeper in the sketch
    manager.onDelivery(brushDelivery(101, 6, 9, 1, 0)); // already held
    manager.onDelivery(brushDelivery(101, 7, 9, 3, 0)); // outside the seed
    expect(log.released).toEqual([{ reason: 1, ranges: [5] }, { reason: 1, ranges: [6] }, { reason: 1, ranges: [7] }]);
    manager.dispose();
  });

  it('keeps only the seed when the work has no stratum under it', async () => {
    const { log, manager } = recorder();
    manager.enqueue(['tiny']);
    manager.onWorkOpened('tiny', opened(7, 200, 100, 1));
    manager.onDelivery(seedDelivery(7, 1, 200, 100));
    await settle();
    expect(getWorkPreview('tiny')).toMatchObject({ width: 200, height: 100 });
    expect(log.receipts).toEqual([{ completed: [1], free: 0 }]);
    manager.dispose();
  });

  it('answers audits and scrapes from every piece it holds', async () => {
    const { log, manager } = await fullPreview();
    manager.onAudit({ handle: 101, order: 1, through: 3 });
    expect(log.inventory).toEqual([[1, 2, 3]]);

    manager.onScrape({ handle: 101, order: 2, epoch: 1, through: 9, predicate: 4, params: scrapeParamsList([3]) });
    expect(log.scraped).toEqual([[1, 2, 4]]);
    await settle();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 600, height: 8 }); // brush 3 predicted from the seed

    manager.onScrape({ handle: 101, order: 3, epoch: 1, through: 9, predicate: 1, params: scrapeParamsLowStratum(10) });
    expect(log.scraped[1]).toEqual([1]);
    await settle();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 });

    manager.onScrape({ handle: 101, order: 4, epoch: 1, through: 9, predicate: 5, params: new Uint8Array() });
    expect(log.scraped[2]).toEqual([]);
    expect(getWorkPreview('work-a')).toBeUndefined();
    manager.dispose();
  });

  it('renews every piece and drops the thumbnail with its seed lease', async () => {
    const { log, manager } = await fullPreview();
    const lease = LEASE_S * 1000;
    const later = performance.now() + lease / 2;
    vi.spyOn(performance, 'now').mockReturnValue(later);
    manager.onRenew({ handle: 101, order: 5, leaseS: LEASE_S, ranges: [1, 2] });
    expect(log.receipts.at(-1)).toEqual({ completed: [], free: 0 });

    manager.sweep(later + lease - 1); // brushes 3 and 4 were not renewed
    expect(log.released).toEqual([{ reason: 3, ranges: [3, 4] }]);
    expect(log.closed).not.toContain(101);

    manager.sweep(later + lease);
    expect(log.released[1]).toEqual({ reason: 3, ranges: [1, 2] });
    expect(log.closed).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
    manager.dispose();
  });

  it('orders pending queue according to the latest sorted ids list', () => {
    const { log, manager } = recorder();
    manager.enqueue(['work-3']);
    expect(log.opened).toEqual(['work-3']);
    // work-3 is loading; the rest queue in the new order and work-1 goes next
    manager.enqueue(['work-1', 'work-2', 'work-3']);
    manager.onError('work-3');
    expect(log.opened).toEqual(['work-3', 'work-1']);
    manager.dispose();
  });
});
