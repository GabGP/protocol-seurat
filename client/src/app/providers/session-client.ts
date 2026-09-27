import { postSession } from '@/shared/api/http';
import type { SeuratTransport } from '@/shared/api/transport';
import { WsTransport } from '@/shared/api/ws';
import { WtTransport } from '@/shared/api/wt';
import { CLIENT_NAME } from '@/app/config';
import { CAP_DATAGRAMAS, CAP_REANUDAR, T } from '@/shared/proto/messages';
import {
  openCore,
  goodbyeCore,
  auditDecode,
  welcomeDecode,
  concessionDecode,
  errorDecode,
  heartbeatCore,
  gazeCore,
  goodbyeDecode,
  errorCore,
  workDecode,
  openedDecode,
  planDecode,
  scrapeDecode,
  renewDecode,
  helloCore,
  helloTlvs,
  receiptCore,
  scrapedCore,
  releaseCore,
  inventoryCore,
  type WorkOpened,
  type Audit,
  type Welcome,
  type Concession,
  type WorkMessage,
  type PlanMsg,
  type ProtocolError,
  type Scrape,
  type Renew,
} from '@/shared/proto/messages';
import { concat, u64Decode, viEncode } from '@/shared/proto/varint';
import { encodeFrame, FatalProtocolError } from '@/shared/proto/frame';
import { splitFrame } from '@/shared/proto/frame';
import { declareMemMib, loadResume, persistResume } from '@/entities/session/store';
import { RateMeter } from '@/shared/lib/rate-meter';

export interface SessionEvents {
  onWelcome(b: Welcome): void;
  onWork(m: WorkMessage): void;
  onWorkOpened(a: WorkOpened): void;
  onConcession(c: Concession): void;
  onPlan(p: PlanMsg): void;
  onScrape(r: Scrape): void;
  onRenew(r: Renew): void;
  onAudit(a: Audit): void;
  onProtocolError(e: ProtocolError): void;
  onPreviewWorkOpened?(id: string, a: WorkOpened): void;
  onPreviewError?(id: string, e: ProtocolError): void;
  onDelivery(bytes: Uint8Array): void;
  onStatus(s: string): void;
  /** The connection died without a fatal error: the provider resumes (REANUDAR) within L. */
  onDisconnect?(): void;
}

function tokenFromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export class SessionClient {
  private transport: SeuratTransport | null = null;
  private welcome: Welcome | null = null;
  private memMib = declareMemMib();
  private disposed = false;
  /** A fatal ERROR (either way) ended the session: no REANUDAR, a fresh start is needed. */
  private fatal = false;
  private pendingOpens: Array<{ id: string; preview: boolean }> = [];
  /** Every byte the server sends on this session: the link rate RECIBO.libre is sized from. */
  readonly meter = new RateMeter();

  constructor(private events: SessionEvents) {}

  get info(): Welcome | null {
    return this.welcome;
  }

  get activeTransport(): SeuratTransport | null {
    return this.transport;
  }

  get failed(): boolean {
    return this.fatal;
  }

  /** New session; with claims, SALUDO carries REANUDAR for what this page still holds (spec 3.4.4). */
  async boot(claims?: Array<{ handle: number; ranges: number[] }>): Promise<void> {
    this.fatal = false;
    this.pendingOpens = [];
    const resume = loadResume();
    const ses = await postSession(CLIENT_NAME, this.memMib, ['webtransport', 'websocket']);
    const token = tokenFromHex(ses.token);
    const t = await this.connect(ses.lienzo, ses.respaldo);
    this.transport = t;
    const claim = resume && claims && claims.length > 0
      ? { previousSession: resume.sessionId, ticket: resume.ticket, claims }
      : undefined;
    const s = { minVersion: 1, maxVersion: 1, caps: CAP_DATAGRAMAS | CAP_REANUDAR, memMib: this.memMib, token, resume: claim };
    t.sendControl(encodeFrame(T.SALUDO, helloCore(s), helloTlvs(s)));
    this.events.onStatus('hello');
  }

  private async connect(url: string, fallbackUrl: string): Promise<SeuratTransport> {
    if (url.startsWith('https://') && WtTransport.supported()) {
      const wt = new WtTransport(url);
      try {
        await wt.connect();
        this.wire(wt);
        this.events.onStatus('webtransport');
        return wt;
      } catch {
        wt.close();
      }
    }
    const ws = new WsTransport(fallbackUrl);
    await ws.connect();
    this.wire(ws);
    this.events.onStatus('websocket');
    return ws;
  }

  wire(t: SeuratTransport): void {
    this.transport = t;
    t.onControl = (frame) => {
      this.meter.record(frame.length, performance.now());
      this.routeControl(frame);
    };
    t.onDelivery = (bytes) => {
      this.meter.record(bytes.length, performance.now());
      this.events.onDelivery(bytes);
    };
    t.onClose = (reason) => {
      if (this.transport !== t) return;
      this.events.onStatus('closed ' + reason);
      if (!this.disposed && !this.fatal) this.events.onDisconnect?.(); // spec 8: POST /sesion + REANUDAR
    };
  }

  private routeControl(frame: Uint8Array): void {
    let parts: Array<{ type: number; payload: Uint8Array }>;
    try {
      parts = splitAll(frame);
    } catch (e) {
      this.fail(0, 'frame: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    for (const { type, payload } of parts) {
      try {
        this.dispatch(type, payload);
      } catch (e) {
        // A malformed payload or an unknown mandatory type (< 0x40) is fatal: ERROR 1, then close (spec 3.2, 8).
        this.fail(type, e instanceof Error ? e.message : String(e));
        return;
      }
    }
  }

  /** ERROR 1 with fatal = 1 precedes the close; the session is gone (no REANUDAR after a protocol failure). */
  private fail(refType: number, msg: string): void {
    this.transport?.sendControl(encodeFrame(T.ERROR, errorCore({ code: 1, fatal: 1, refType, msg: msg.slice(0, 120) })));
    this.fatal = true;
    this.transport?.close();
    this.events.onStatus('protocol error: ' + msg);
  }

  private dispatch(type: number, payload: Uint8Array): void {
    switch (type) {
      case T.BIENVENIDA: {
        const b = welcomeDecode(payload);
        this.welcome = b;
        if (b.ticket.length === 32 && b.sessionId !== null) persistResume(b.sessionId, b.ticket);
        this.events.onWelcome(b);
        break;
      }
      case T.LATIDO:
        this.transport?.sendControl(encodeFrame(T.ECO, heartbeatCore(u64Nonce(payload))));
        break;
      case T.ADIOS:
        goodbyeDecode(payload);
        this.transport?.close(); // orderly close by the server; the book survives L + delta (REANUDAR)
        this.events.onStatus('adios');
        break;
      case T.ERROR: {
        const err = errorDecode(payload);
        if (err.fatal === 1) this.fatal = true;
        const req = this.pendingOpens.length > 0 && err.refType === T.ABRIR ? this.pendingOpens.shift() : undefined;
        if (req?.preview) {
          this.events.onPreviewError?.(req.id, err);
        } else {
          this.events.onProtocolError(err);
        }
        break;
      }
      case T.OBRA:
        this.events.onWork(workDecode(payload));
        break;
      case T.ABIERTA: {
        const a = openedDecode(payload);
        const req = this.pendingOpens.shift();
        if (req?.preview) {
          this.events.onPreviewWorkOpened?.(req.id, a);
        } else {
          this.events.onWorkOpened(a);
        }
        break;
      }
      case T.CONCESION:
        this.events.onConcession(concessionDecode(payload));
        break;
      case T.PLAN:
        this.events.onPlan(planDecode(payload));
        break;
      case T.RASPAR:
        this.events.onScrape(scrapeDecode(payload));
        break;
      case T.RENOVAR:
        this.events.onRenew(renewDecode(payload));
        break;
      case T.AUDITAR:
        this.events.onAudit(auditDecode(payload));
        break;
      default:
        // C->S types (SALUDO, MIRADA, RECIBO…) are as invalid here as unknown ones below 0x40.
        if (type < 0x40) throw new FatalProtocolError('unexpected mandatory type 0x' + type.toString(16));
        break;
    }
  }

  requestCatalog(): void {
    this.transport?.sendControl(encodeFrame(T.CATALOGO, new Uint8Array(0)));
  }

  openWork(id: string): void {
    this.pendingOpens.push({ id, preview: false });
    this.transport?.sendControl(encodeFrame(T.ABRIR, openCore(id)));
  }

  openPreview(id: string): void {
    this.pendingOpens.push({ id, preview: true });
    this.transport?.sendControl(encodeFrame(T.ABRIR, openCore(id)));
  }

  closeHandle(handle: number): void {
    this.transport?.sendControl(encodeFrame(T.CERRAR, concat(viEncode(handle))));
  }

  sendGazeReliable(m: { handle: number; seq: number; x0: number; y0: number; x1: number; y1: number; vw: number; vh: number; flags: number }): void {
    this.transport?.sendControl(encodeFrame(T.MIRADA, gazeCore(m)));
  }

  sendReceipt(handle: number, completed: number[], queueMs: number, free: number, renewThrough: number): void {
    this.transport?.sendControl(encodeFrame(T.RECIBO, receiptCore({ handle, completed, queueMs, free, renewThrough })));
  }

  sendRelease(handle: number, reason: number, ranges: number[]): void {
    if (ranges.length === 0) return;
    this.transport?.sendControl(encodeFrame(T.SOLTAR, releaseCore({ handle, reason, ranges })));
  }

  sendScraped(handle: number, order: number, epoch: number, through: number, scrapedCount: number, freedKib: number, kept: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.RASPADO, scrapedCore({ handle, order, epoch, through, scrapedCount, freedKib, kept })),
    );
  }

  sendInventory(handle: number, order: number, through: number, brushCount: number, kib: number, ranges: number[]): void {
    this.transport?.sendControl(
      encodeFrame(T.INVENTARIO, inventoryCore({ handle, order, through, brushCount, kib, ranges })),
    );
  }

  sendGoodbye(): void {
    try {
      this.transport?.sendControl(encodeFrame(T.ADIOS, goodbyeCore({ code: 0, msg: 'adios' })));
    } catch {
      /* closing */
    }
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.close();
    this.transport = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

function u64Nonce(payload: Uint8Array): bigint {
  return u64Decode(payload, 0).value;
}

function splitAll(frame: Uint8Array): Array<{ type: number; payload: Uint8Array }> {
  const out: Array<{ type: number; payload: Uint8Array }> = [];
  let pos = 0;
  while (pos < frame.length) {
    const s = splitFrame(frame.slice(pos));
    out.push({ type: s.type, payload: s.payload });
    pos += s.total;
  }
  return out;
}
