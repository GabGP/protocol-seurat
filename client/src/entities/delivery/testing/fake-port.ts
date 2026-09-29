import type { DeliveryPort } from '../sink/port';

/** A DeliveryPort that records every message the sink sends the server. */
export function fakeClient() {
  const sentRelease: Array<{ handle: number; reason: number; ranges: number[] }> = [];
  const sentScraped: Array<{ handle: number; order: number; epoch: number; through: number; scrapedCount: number; freedKib: number; kept: number[] }> = [];
  const sentReceipt: Array<{ handle: number; completed: number[]; queueMs: number; free: number; renewThrough: number }> = [];
  const sentInventory: Array<{ handle: number; order: number; through: number; brushCount: number; kib: number; ranges: number[] }> = [];

  const c = {
    sentRelease,
    sentScraped,
    sentReceipt,
    sentInventory,
    sendRelease(handle: number, reason: number, ranges: number[]) {
      sentRelease.push({ handle, reason, ranges });
    },
    sendScraped(handle: number, order: number, epoch: number, through: number, scrapedCount: number, freedKib: number, kept: number[]) {
      sentScraped.push({ handle, order, epoch, through, scrapedCount, freedKib, kept });
    },
    sendReceipt(handle: number, completed: number[], queueMs: number, free: number, renewThrough: number) {
      sentReceipt.push({ handle, completed, queueMs, free, renewThrough });
    },
    sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]) {
      sentInventory.push({ handle, order, through, brushCount, kib, ranges });
    },
  };
  return c as unknown as DeliveryPort & typeof c;
}
