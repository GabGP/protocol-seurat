import { WT_READY_TIMEOUT_MS } from '../config/constants';
import { hexToBytes } from '../lib/hex';
import { withTimeout } from '../lib/with-timeout';
import { GazeRate } from './gaze-rate';
import type { CloseHandler, ControlHandler, DeliveryHandler, SeuratTransport } from './transport';
import { drainFrames } from './wt-frames';

interface WtStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface WtInstance {
  ready: Promise<void>;
  closed: Promise<unknown>;
  datagrams: { writable: WritableStream<Uint8Array> } | null;
  createBidirectionalStream(): Promise<WtStream>;
  incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  close(): void;
}

declare global {
  interface Window {
    WebTransport?: new (url: string, opts?: unknown) => WtInstance;
  }
}

export class WtTransport implements SeuratTransport {
  readonly name = 'webtransport' as const;
  readonly supportsDatagrams = true;
  onControl: ControlHandler | null = null;
  onDelivery: DeliveryHandler | null = null;
  onClose: CloseHandler | null = null;
  private wt: WtInstance | null = null;
  private ctrlWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private dgWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private closed = false;
  private notified = false;
  private gaze = new GazeRate();

  constructor(private url: string, private certHash?: string) {}

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof window.WebTransport === 'function';
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (!WtTransport.supported() || !window.WebTransport) throw new Error('wt: unsupported');
    const opts = this.certHash
      ? { serverCertificateHashes: [{ algorithm: 'sha-256', value: hexToBytes(this.certHash) }] }
      : undefined;
    const wt = new window.WebTransport(this.url, opts);
    await withTimeout(wt.ready, WT_READY_TIMEOUT_MS, 'wt: ready timeout');
    if (signal?.aborted) {
      wt.close();
      throw new Error('wt: aborted');
    }
    this.wt = wt;
    wt.closed.then(() => this.lost('wt closed'), () => this.lost('wt closed'));
    const bidi = await wt.createBidirectionalStream();
    this.pumpControl(bidi.readable);
    this.ctrlWriter = bidi.writable.getWriter();
    if (wt.datagrams) this.dgWriter = wt.datagrams.writable.getWriter();
    this.pumpDeliveries(wt.incomingUnidirectionalStreams);
  }

  private lost(reason: string): void {
    if (this.closed || this.notified) return;
    this.notified = true;
    this.onClose?.(reason);
  }

  private async pumpControl(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          this.lost('wt control ended');
          break;
        }
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf, 0);
        next.set(value, buf.length);
        buf = drainFrames(next, (frame) => this.onControl?.(frame));
      }
    } catch {
      this.lost('wt control lost');
    }
  }

  private async pumpDeliveries(src: ReadableStream<ReadableStream<Uint8Array>>): Promise<void> {
    const reader = src.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.pumpDelivery(value);
      }
    } catch {
      this.lost('wt deliveries lost');
    }
  }

  private async pumpDelivery(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.length;
      }
    } catch {
      return;
    }
    const out = new Uint8Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    this.onDelivery?.(out);
  }

  sendControl(frame: Uint8Array): void {
    this.ctrlWriter?.write(frame).catch(() => this.lost('wt control write failed'));
  }

  sendGazeDatagram(payload: Uint8Array): void {
    if (!this.gaze.allow(performance.now())) return;
    this.dgWriter?.write(payload).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    try {
      this.ctrlWriter?.releaseLock();
      this.dgWriter?.releaseLock();
      this.wt?.close();
    } catch {
      // stream that already failed throws on release
    }
    this.wt = null;
  }
}
