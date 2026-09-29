import { WT_READY_TIMEOUT_MS } from '../config/constants';
import { withTimeout } from '../lib/with-timeout';
import { viDecode } from '../proto/varint';
import type { CloseHandler, ControlHandler, DeliveryHandler, SeuratTransport } from './transport';

const WtFrameSplit = { viDecode };

interface WtStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface WtInstance {
  ready: Promise<void>;
  datagrams: { writable: WritableStream<Uint8Array> } | null;
  createBidirectionalStream(): Promise<WtStream>;
  incomingUnidirectionalStreams: ReadableStream<WtStream> | { getReader(): ReadableStreamDefaultReader<WtStream> };
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

  constructor(private url: string) {}

  static supported(): boolean {
    return typeof window !== 'undefined' && typeof window.WebTransport === 'function';
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (!WtTransport.supported() || !window.WebTransport) throw new Error('wt: unsupported');
    const wt = new window.WebTransport(this.url);
    await withTimeout(wt.ready, WT_READY_TIMEOUT_MS, 'wt: ready timeout');
    if (signal?.aborted) {
      wt.close();
      throw new Error('wt: aborted');
    }
    this.wt = wt;
    const bidi = await wt.createBidirectionalStream();
    this.pumpControl(bidi.readable);
    this.ctrlWriter = bidi.writable.getWriter();
    if (wt.datagrams) this.dgWriter = wt.datagrams.writable.getWriter();
    this.pumpDeliveries(wt.incomingUnidirectionalStreams);
  }

  private async pumpControl(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    let buf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf, 0);
        next.set(value, buf.length);
        buf = next;
        buf = this.emitFrames(buf);
      }
    } catch {
      if (!this.closed) this.onClose?.('wt control lost');
    }
  }

  private emitFrames(buf: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    let pos = 0;
    for (;;) {
      if (pos >= buf.length) break;
      const { viDecode } = WtFrameSplit;
      try {
        const t = viDecode(buf, pos);
        const l = viDecode(buf, t.next);
        if (l.next + l.value > buf.length) break;
        this.onControl?.(buf.slice(pos, l.next + l.value));
        pos = l.next + l.value;
      } catch {
        break;
      }
    }
    return buf.slice(pos);
  }

  private async pumpDeliveries(src: ReadableStream<WtStream> | { getReader(): ReadableStreamDefaultReader<WtStream> }): Promise<void> {
    const reader = src.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.pumpDelivery(value.readable);
      }
    } catch {
      if (!this.closed) this.onClose?.('wt deliveries lost');
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
    this.ctrlWriter?.write(frame).catch(() => this.onClose?.('wt control write failed'));
  }

  sendGazeDatagram(payload: Uint8Array): void {
    this.dgWriter?.write(payload).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    this.ctrlWriter?.releaseLock();
    this.dgWriter?.releaseLock();
    this.wt?.close();
    this.wt = null;
  }
}
