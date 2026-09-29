import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewManager } from '../model/preview-manager';
import { clearWorkPreviews, getWorkPreview, notePreviewWidth } from '@/entities/work';
import { MFLAGS_STILL, scrapeParamsList, scrapeParamsLowStratum, type WorkOpened } from '@/shared/proto/messages';
import {
  LEASE_S, PREVIEW_CREDIT, PREVIEW_GAZE_KEEPALIVE_MS, PREVIEW_OPENS, PREVIEW_OPEN_TIMEOUT_MS,
} from '@/shared/config/constants';
import type { SessionClient } from '@/entities/session';
import type { WorkerFactory } from '@/entities/delivery';
import { brushDelivery, inlineWorkers, seedDelivery, settle } from './preview-fixtures';

/** A 300 × 4 seed under a work of 11 strata: stratum 9 has 3 × 1 brushes under it, stratum 8 has 5 × 1. */
const opened = (handle: number, seedWidth = 300, seedHeight = 4, strata = 11): WorkOpened => ({
  handle, width: 76_800, height: 1024, strata, edition: 1, ceilingStratum: 10, ceilingBands: 4, seedWidth, seedHeight,
});
const FLAT = [120, 140, 200, 255];

function recorder(workers = inlineWorkers) {
  const log = {
    opened: [] as string[], closed: [] as number[], receipts: [] as Array<{ completed: number[]; free: number }>,
    released: [] as Array<{ reason: number; ranges: number[] }>, scraped: [] as Array<{ count: number; kept: number[] }>,
    inventory: [] as number[][], gazes: [] as Array<Record<string, number>>,
  };
  const client = {
    openPreview: (id: string) => log.opened.push(id),
    closeHandle: (h: number) => log.closed.push(h),
    sendGazeReliable: (g: Record<string, number>) => log.gazes.push(g),
    sendReceipt: (_h: number, completed: number[], _q: number, free: number) => log.receipts.push({ completed, free }),
    sendRelease: (_h: number, reason: number, ranges: number[]) => log.released.push({ reason, ranges }),
    sendScraped: (...a: unknown[]) => log.scraped.push({ count: a[4] as number, kept: a[6] as number[] }),
    sendInventory: (...a: unknown[]) => log.inventory.push(a[5] as number[]),
  } as unknown as SessionClient;
  return { log, manager: new PreviewManager(() => client, workers) };
}

/** Opens work-a as handle 101 and delivers its seed and three stratum-9 brushes. */
async function fullPreview(workers = inlineWorkers) {
  const r = recorder(workers);
  r.manager.enqueue(['work-a', 'work-b']);
  r.manager.onWorkOpened('work-a', opened(101));
  r.manager.onDelivery(seedDelivery(101, 1, 300, 4));
  await settle();
  for (let bx = 0; bx < 3; bx++) r.manager.onDelivery(brushDelivery(101, 2 + bx, 9, bx, 0));
  await settle();
  return r;
}

describe('PreviewManager', () => {
  beforeEach(() => {
    clearWorkPreviews();
    notePreviewWidth(300); // cards 300 device px wide: the cone stops at stratum 8
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks for the card resolution with a MIRADA and shows each stratum the cone brings', async () => {
    notePreviewWidth(600);
    const { log, manager } = recorder();
    manager.enqueue(['work-a', 'work-b']);
    manager.onWorkOpened('work-a', opened(101));
    expect(log.gazes).toEqual([
      { handle: 101, seq: 1, x0: 0, y0: 0, x1: 76_800, y1: 1024, vw: 600, vh: 8, flags: MFLAGS_STILL },
    ]);
    expect(manager.onDelivery(seedDelivery(101, 1, 300, 4))).toBe(true);
    await vi.waitFor(() => expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 }));
    expect(log.opened).toEqual(['work-a', 'work-b']);

    for (let bx = 0; bx < 3; bx++) manager.onDelivery(brushDelivery(101, 2 + bx, 9, bx, 0));
    await vi.waitFor(() => expect(getWorkPreview('work-a')).toMatchObject({ width: 600, height: 8 }));
    const img = getWorkPreview('work-a');
    expect(Array.from(img?.rgba.subarray(0, 4) ?? [])).toEqual(FLAT);
    expect(log.receipts.map((r) => r.free)).toEqual([PREVIEW_CREDIT, PREVIEW_CREDIT, PREVIEW_CREDIT, PREVIEW_CREDIT]);

    manager.dispose();
    expect(log.closed).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
  });

  it('keeps the thumbnail at the card width however deep the strata under it go', async () => {
    const { log, manager } = await fullPreview();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 }); // 600 × 8 shrunk to the card
    for (let bx = 0; bx < 5; bx++) manager.onDelivery(brushDelivery(101, 5 + bx, 8, bx, 0));
    manager.onDelivery(brushDelivery(101, 10, 8, 0, 0, 0x12)); // a retouch: band 1 on top of band 0
    await settle();
    const img = getWorkPreview('work-a');
    expect(img).toMatchObject({ width: 300, height: 4 });
    expect(Array.from(img?.rgba.subarray(0, 4) ?? [])).toEqual(FLAT);
    expect(log.released).toEqual([]);
    manager.dispose();
  });

  it('decodes again only the brushes a new piece stands under', async () => {
    const decoded: string[] = [];
    const counting: WorkerFactory = () => {
      const w = inlineWorkers();
      const post = w.postMessage.bind(w);
      w.postMessage = (req, ...rest) => { decoded.push(req.brush); post(req, ...rest); };
      return w;
    };
    const { manager } = await fullPreview(counting);
    decoded.length = 0;
    for (let bx = 0; bx < 5; bx++) manager.onDelivery(brushDelivery(101, 5 + bx, 8, bx, 0));
    await settle();
    expect(decoded.length).toBe(5); // seed and stratum 9 kept: only stratum 8 is new
    decoded.length = 0;
    manager.onDelivery(brushDelivery(101, 10, 8, 0, 0, 0x12));
    await settle();
    expect(decoded.length).toBe(1); // the retouched brush alone
    manager.dispose();
  });

  it('releases what is finer than the card, already held, or outside the work', async () => {
    const { log, manager } = await fullPreview();
    manager.onDelivery(brushDelivery(101, 5, 7, 0, 0)); // finer than the card needs
    manager.onDelivery(brushDelivery(101, 6, 9, 1, 0)); // band 0 already held
    manager.onDelivery(brushDelivery(101, 7, 9, 3, 0)); // outside the work
    manager.onDelivery(brushDelivery(101, 8, 9, 1, 0, 0x12)); // new band: kept
    manager.onDelivery(brushDelivery(101, 9, 9, 1, 0, 0x12)); // that band again
    expect(log.released).toEqual([
      { reason: 1, ranges: [5] }, { reason: 1, ranges: [6] }, { reason: 1, ranges: [7] }, { reason: 1, ranges: [9] },
    ]);
    manager.dispose();
  });

  it('keeps only the seed, without a MIRADA, when the work has no stratum under it', async () => {
    const { log, manager } = recorder();
    manager.enqueue(['tiny']);
    manager.onWorkOpened('tiny', opened(7, 200, 100, 1));
    manager.onDelivery(seedDelivery(7, 1, 200, 100));
    await settle();
    expect(getWorkPreview('tiny')).toMatchObject({ width: 200, height: 100 });
    expect(log.gazes).toEqual([]);
    expect(log.receipts).toEqual([{ completed: [1], free: PREVIEW_CREDIT }]);
    manager.dispose();
  });

  it('answers audits and scrapes from every piece it holds, with what stood on a scraped one', async () => {
    const { log, manager } = await fullPreview();
    manager.onDelivery(brushDelivery(101, 5, 8, 2, 0)); // under brush (9, 1, 0), delivery 3
    manager.onAudit({ handle: 101, order: 1, through: 3 });
    expect(log.inventory).toEqual([[1, 2, 3]]);

    manager.onScrape({ handle: 101, order: 2, epoch: 1, through: 9, predicate: 4, params: scrapeParamsList([3]) });
    expect(log.scraped).toEqual([{ count: 2, kept: [1, 2, 4] }]);
    await settle();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 }); // brush 3 predicted from the seed

    manager.onScrape({ handle: 101, order: 3, epoch: 1, through: 9, predicate: 1, params: scrapeParamsLowStratum(10) });
    expect(log.scraped[1]).toEqual({ count: 2, kept: [1] });
    await settle();
    expect(getWorkPreview('work-a')).toMatchObject({ width: 300, height: 4 });

    manager.onScrape({ handle: 101, order: 4, epoch: 1, through: 9, predicate: 5, params: new Uint8Array() });
    expect(log.scraped[2]).toEqual({ count: 1, kept: [] });
    expect(getWorkPreview('work-a')).toBeUndefined();
    manager.dispose();
  });

  it('renews every piece and drops the thumbnail with its seed lease', async () => {
    const { log, manager } = await fullPreview();
    const lease = LEASE_S * 1000;
    const later = performance.now() + lease / 2;
    vi.spyOn(performance, 'now').mockReturnValue(later);
    manager.onRenew({ handle: 101, order: 5, leaseS: LEASE_S, ranges: [1, 2] });
    expect(log.receipts.at(-1)).toEqual({ completed: [], free: PREVIEW_CREDIT });

    manager.sweep(later + lease - 1); // brushes 3 and 4 were not renewed
    expect(log.released).toEqual([{ reason: 3, ranges: [3, 4] }]);
    expect(log.closed).not.toContain(101);

    manager.sweep(later + lease);
    expect(log.released[1]).toEqual({ reason: 3, ranges: [1, 2] });
    expect(log.closed).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
    manager.dispose();
  });

  it('repeats a card MIRADA before the server floors it for inactivity', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { log, manager } = await fullPreview();
    manager.sweep(1000 + PREVIEW_GAZE_KEEPALIVE_MS - 1);
    expect(log.gazes.map((g) => g.seq)).toEqual([1]);
    manager.sweep(1000 + PREVIEW_GAZE_KEEPALIVE_MS);
    expect(log.gazes.map((g) => [g.handle, g.seq])).toEqual([[101, 1], [101, 2]]);
    manager.dispose();
  });

  it('opens a few works at once, in the order of the latest sorted ids list', () => {
    const { log, manager } = recorder();
    const ids = Array.from({ length: PREVIEW_OPENS + 2 }, (_, i) => `work-${i}`);
    const last = ids.at(-1) ?? '';
    manager.enqueue([last]);
    expect(log.opened).toEqual([last]);
    // `last` is being opened; the rest queue in the new order and fill the free slots
    manager.enqueue(ids);
    expect(log.opened).toEqual([last, ...ids.slice(0, PREVIEW_OPENS - 1)]);
    manager.onError(last);
    expect(log.opened.at(-1)).toBe(ids[PREVIEW_OPENS - 1]);
    manager.dispose();
  });

  it('gives up a work that brings no seed in time and opens the next', () => {
    vi.useFakeTimers();
    const { log, manager } = recorder();
    const ids = Array.from({ length: PREVIEW_OPENS + 1 }, (_, i) => `work-${i}`);
    manager.enqueue(ids);
    manager.onWorkOpened('work-0', opened(101));
    vi.advanceTimersByTime(PREVIEW_OPEN_TIMEOUT_MS);
    expect(log.closed).toContain(101);
    expect(log.opened).toEqual(ids);
    manager.dispose();
    vi.useRealTimers();
  });
});
