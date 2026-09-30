import { GAZE_PER_S, MS_PER_S } from '../config/constants';
import type { CloseHandler, ControlHandler, DeliveryHandler, SeuratTransport } from './transport';

const CONTROL_CHANNEL = 0;
const DELIVERY_CHANNEL = 1;
const GAZE_CHANNEL = 2;

export class WsTransport implements SeuratTransport {
  readonly name = 'websocket' as const;
  readonly supportsDatagrams = false;
  onControl: ControlHandler | null = null;
  onDelivery: DeliveryHandler | null = null;
  onClose: CloseHandler | null = null;
  private ws: WebSocket | null = null;
  private gazeTimes: number[] = [];

  constructor(
    private url: string,
    private protocol = 'seurat.1',
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, this.protocol);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };
      ws.onerror = () => reject(new Error('ws: connect failed'));
      ws.onclose = (ev) => this.onClose?.('ws close ' + ev.code);
      ws.onmessage = (ev) => this.route(ev.data as ArrayBuffer);
    });
  }

  private route(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (bytes.length < 1) return;
    const channel = bytes[0];
    // A view past the channel byte, not a copy: every consumer reads by index and copies the bands it keeps
    // (sliceBands, splitAll), and none hands `.buffer` on, so byteOffset 1 is safe (no ~100 KB copy per delivery).
    const rest = bytes.subarray(1);
    if (channel === CONTROL_CHANNEL) this.onControl?.(rest);
    else if (channel === DELIVERY_CHANNEL) this.onDelivery?.(rest);
  }

  sendControl(frame: Uint8Array): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Never dropped: RASPADO, SOLTAR and RECIBO are accounting, and the stream is ordered (spec 3.1).
    const out = new Uint8Array(frame.length + 1);
    out[0] = CONTROL_CHANNEL;
    out.set(frame, 1);
    ws.send(out);
  }

  sendGazeDatagram(payload: Uint8Array): void {
    const now = performance.now();
    this.gazeTimes = this.gazeTimes.filter((t) => now - t < MS_PER_S);
    if (this.gazeTimes.length >= GAZE_PER_S) return;
    this.gazeTimes.push(now);
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const out = new Uint8Array(payload.length + 1);
    out[0] = GAZE_CHANNEL;
    out.set(payload, 1);
    ws.send(out);
  }

  close(): void {
    this.ws?.close(1000, 'adios');
    this.ws = null;
  }
}
