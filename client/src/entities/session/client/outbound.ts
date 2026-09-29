import type { SeuratTransport } from '@/shared/api/transport';
import { T } from '@/shared/proto/messages';
import {
  gazeCore,
  goodbyeCore,
  inventoryCore,
  openCore,
  receiptCore,
  releaseCore,
  scrapedCore,
} from '@/shared/proto/messages';
import { encodeFrame } from '@/shared/proto/frame';
import { concat, viEncode } from '@/shared/proto/varint';
import type { OpenQueue } from './open-queue';

/** Every client-to-server control frame. The transport lives in the subclass, so senders no-op while it is down. */
export abstract class Outbound {
  protected transport: SeuratTransport | null = null;
  protected abstract readonly opens: OpenQueue;

  private send(type: number, core: Uint8Array): void {
    this.transport?.sendControl(encodeFrame(type, core));
  }

  requestCatalog(): void {
    this.send(T.CATALOGO, new Uint8Array(0));
  }

  openWork(id: string): void {
    this.opens.push(id, false);
    this.send(T.ABRIR, openCore(id));
  }

  openPreview(id: string): void {
    this.opens.push(id, true);
    this.send(T.ABRIR, openCore(id));
  }

  closeHandle(handle: number): void {
    this.send(T.CERRAR, concat(viEncode(handle)));
  }

  sendGazeReliable(m: { handle: number; seq: number; x0: number; y0: number; x1: number; y1: number; vw: number; vh: number; flags: number }): void {
    this.send(T.MIRADA, gazeCore(m));
  }

  sendReceipt(handle: number, completed: number[], queueMs: number, free: number, renewThrough: number): void {
    this.send(T.RECIBO, receiptCore({ handle, completed, queueMs, free, renewThrough }));
  }

  sendRelease(handle: number, reason: number, ranges: number[]): void {
    if (ranges.length === 0) return;
    this.send(T.SOLTAR, releaseCore({ handle, reason, ranges }));
  }

  sendScraped(handle: number, order: number, epoch: number, through: number, scrapedCount: number, freedKib: number, kept: number[]): void {
    this.send(T.RASPADO, scrapedCore({ handle, order, epoch, through, scrapedCount, freedKib, kept }));
  }

  sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]): void {
    this.send(T.INVENTARIO, inventoryCore({ handle, order, through, brushCount, kib, ranges }));
  }

  sendGoodbye(): void {
    try {
      this.send(T.ADIOS, goodbyeCore({ code: 0, msg: 'adios' }));
    } catch {
      /* closing */
    }
  }
}
