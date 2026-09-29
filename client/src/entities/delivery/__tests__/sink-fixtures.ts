import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import type { DeliveryPort } from '../sink/port';

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

export function makeDeliveryBytes(opts: {
  handle: number;
  delivery: number;
  brushId: bigint;
  from: number;
  through: number;
  epoch: number;
  qY?: number;
  qC?: number;
  corruptCrc?: boolean;
}): Uint8Array {
  const band = new Uint8Array([10, 20, 30, 40, 50]);
  const bandCrc = crc32c(band);
  const crcVal = opts.corruptCrc ? bandCrc ^ 0xff : bandCrc;

  const bIdBuf = new Uint8Array(8);
  new DataView(bIdBuf.buffer).setBigUint64(0, opts.brushId);

  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crcVal);

  const head = concat(
    viEncode(0x01),
    viEncode(opts.handle),
    viEncode(opts.delivery),
    bIdBuf,
    new Uint8Array([((opts.from & 0xf) << 4) | (opts.through & 0xf)]),
    viEncode(opts.epoch),
    new Uint8Array([opts.qY ?? 4, opts.qC ?? 6]),
    viEncode(1), // edition
    crcBuf,
    viEncode(band.length),
  );
  return concat(head, band);
}
