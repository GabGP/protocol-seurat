import { describe, expect, it } from 'vitest';
import { PreviewManager } from '../model/preview-manager';
import { clearWorkPreviews, getWorkPreview } from '@/entities/work/previews';
import { makeBrushId } from '@/shared/proto/brush';
import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';
import { ulebEncode, zigzagEncode } from '@/shared/codec/leb128';
import { rgbToYCoCg } from '@/shared/codec/ycocgr';
import type { SessionClient } from '@/app/providers/session-client';

async function compressDeflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;

  const readPromise = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  })();

  await writer.write(data as unknown as Uint8Array<ArrayBuffer>);
  await writer.close();
  return readPromise;
}

async function makeSeedDelivery(handle: number, w: number, h: number): Promise<Uint8Array> {
  const Y: number[] = [];
  const Co: number[] = [];
  const Cg: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yco = rgbToYCoCg(120, 140, 200);
      Y.push(yco.y);
      Co.push(yco.co);
      Cg.push(yco.cg);
    }
  }

  const raw: number[] = [];
  for (const pl of [Y, Co, Cg]) {
    for (let y = 0; y < h; y++) {
      let left = 0;
      for (let x = 0; x < w; x++) {
        const v = pl[y * w + x]!;
        raw.push(...ulebEncode(zigzagEncode(v - left)));
        left = v;
      }
    }
  }

  const band = await compressDeflateRaw(new Uint8Array(raw));
  const c = crc32c(band);
  const bIdBuf = new Uint8Array(8);
  const brushId = makeBrushId(10, 0, 0); // stratum 10
  new DataView(bIdBuf.buffer).setBigUint64(0, brushId);
  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, c);

  return concat(
    viEncode(0x01), // PINCELADA
    viEncode(handle),
    viEncode(1), // delivery 1
    bIdBuf,
    [0x01], // from=0, through=1
    viEncode(1), // epoch
    [1, 1], // qY, qC (lossless)
    viEncode(1), // edition
    crcBuf,
    viEncode(band.length),
    band,
  );
}

describe('PreviewManager', () => {
  it('queues, loads the seed, keeps its canvas open with libre 0, and closes it on pause', async () => {
    clearWorkPreviews();

    const openedPreviews: string[] = [];
    const closedHandles: number[] = [];

    const receipts: Array<{ handle: number; completed: number[]; free: number }> = [];
    const mockClient = {
      openPreview: (id: string) => {
        openedPreviews.push(id);
      },
      closeHandle: (handle: number) => {
        closedHandles.push(handle);
      },
      sendReceipt: (handle: number, completed: number[], _q: number, free: number) => {
        receipts.push({ handle, completed, free });
      },
      sendRelease: () => {},
    } as unknown as SessionClient;

    const manager = new PreviewManager(() => mockClient);

    // 1. Enqueue works
    manager.enqueue(['work-a', 'work-b']);
    expect(openedPreviews).toEqual(['work-a']);

    // 2. Server responds with ABIERTA for work-a
    manager.onWorkOpened('work-a', {
      handle: 101,
      width: 1920,
      height: 1080,
      strata: 11,
      edition: 1,
      ceilingStratum: 10,
      ceilingBands: 4,
      seedWidth: 4,
      seedHeight: 4,
    });

    // 3. Server streams delivery 1 (seed)
    const seedBytes = await makeSeedDelivery(101, 4, 4);
    const consumed = manager.onDelivery(seedBytes);
    expect(consumed).toBe(true);

    // Wait for async decode and advance
    await new Promise((r) => setTimeout(r, 50));

    // Verify work-a preview was cached
    const previewA = getWorkPreview('work-a');
    expect(previewA).toBeDefined();
    expect(previewA?.width).toBe(4);
    expect(previewA?.height).toBe(4);
    expect(previewA?.rgba.length).toBe(4 * 4 * 4);

    // The seed is a loan: acknowledged with libre 0, canvas kept open while the thumbnail is shown
    expect(receipts).toEqual([{ handle: 101, completed: [1], free: 0 }]);
    expect(closedHandles).not.toContain(101);

    // Verify next queued work (work-b) was opened
    expect(openedPreviews).toEqual(['work-a', 'work-b']);

    // Leaving the gallery: CERRAR releases it all, so the thumbnail goes too
    manager.dispose();
    expect(closedHandles).toContain(101);
    expect(getWorkPreview('work-a')).toBeUndefined();
  });

  it('orders pending queue according to the latest sorted ids list', () => {
    const opened: string[] = [];
    const mockClient = {
      openPreview: (id: string) => {
        opened.push(id);
      },
      closeHandle: () => {},
    } as unknown as SessionClient;

    const manager = new PreviewManager(() => mockClient);
    // Initial enqueue opens first item ('work-3')
    manager.enqueue(['work-3']);
    expect(opened).toEqual(['work-3']);

    // Now a batch arrives where natural sort places work-1 and work-2 ahead of work-3
    manager.enqueue(['work-1', 'work-2', 'work-3']);
    // Since work-3 is active, the queue has work-1 and work-2 sorted
    // Once work-3 finishes/errors, work-1 is next
    manager.onError('work-3');
    expect(opened).toEqual(['work-3', 'work-1']);

    manager.dispose();
  });
});
