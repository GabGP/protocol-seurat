import type { SeuratTransport } from '@/shared/api/transport';
import { PROTO_VERSION } from '@/shared/config/constants';
import { HEARTBEAT_S } from '@/shared/config/session';
import { hexToBytes } from '@/shared/lib/hex';
import { RateMeter } from '@/shared/lib/rate-meter';
import { encodeFrame } from '@/shared/proto/frame';
import { CAP_DATAGRAMAS, CAP_REANUDAR, CAP_REGULACION, T, helloCore, helloTlvs, type Welcome } from '@/shared/proto/messages';
import { sessionInfoOf } from '../session-info';
import { declareMemMib, loadResume } from '../store';
import { authenticate, connectTransport } from './connect';
import { ControlRouter } from './control-router';
import { OpenQueue } from './open-queue';
import { Outbound } from './outbound';
import type { SessionEvents } from './session-events';
import { Watchdog } from './watchdog';

export type { SessionEvents } from './session-events';

/** One connection to the server: boots the session, routes what arrives, and (through `Outbound`) sends what the app owes. */
export class SessionClient extends Outbound {
  private welcome: Welcome | null = null;
  private readonly memMib = declareMemMib();
  private disposed = false;
  /** A fatal ERROR (either way) ended the session: no REANUDAR, a fresh start is needed. */
  private fatal = false;
  protected readonly opens = new OpenQueue();
  /** The current transport is open: set when it connects, cleared when it closes. */
  private live = false;
  /** Every byte the server sends on this session: the link rate RECIBO.libre is sized from. */
  readonly meter = new RateMeter();
  private readonly router: ControlRouter;
  /** Silence longer than HEARTBEAT_MISSES heartbeats closes the transport as lost. */
  private readonly watchdog = new Watchdog(() => this.loseLink('silent'));

  constructor(private events: SessionEvents) {
    super();
    this.router = new ControlRouter(events, this.opens, {
      send: (frame) => this.transport?.sendControl(frame),
      close: () => this.transport?.close(),
      welcomed: (b) => { this.welcome = b; },
      markFatal: () => { this.fatal = true; },
    });
  }

  get info(): Welcome | null { return this.welcome; }
  get activeTransport(): SeuratTransport | null { return this.transport; }
  get connected(): boolean { return this.live; }
  get failed(): boolean { return this.fatal; }
  get isDisposed(): boolean { return this.disposed; }

  /** New session; with claims, SALUDO carries REANUDAR for what this page still holds (spec 3.4.4). */
  async boot(claims?: Array<{ handle: number; ranges: number[] }>): Promise<void> {
    this.fatal = false;
    this.opens.clear();
    const resume = loadResume();
    const ses = await authenticate(this.memMib);
    this.events.onSessionInfo?.(sessionInfoOf(ses));
    const token = hexToBytes(ses.token);
    const t = await connectTransport(ses.lienzo, ses.respaldo, (x) => this.wire(x), (s) => this.events.onStatus(s));
    this.transport = t;
    const claim = resume && claims && claims.length > 0
      ? { previousSession: resume.sessionId, ticket: resume.ticket, claims }
      : undefined;
    const s = { minVersion: PROTO_VERSION, maxVersion: PROTO_VERSION, caps: CAP_DATAGRAMAS | CAP_REANUDAR | CAP_REGULACION, memMib: this.memMib, token, resume: claim };
    t.sendControl(encodeFrame(T.SALUDO, helloCore(s), helloTlvs(s)));
    this.events.onStatus('hello');
  }

  wire(t: SeuratTransport): void {
    this.transport = t;
    this.live = true;
    const heard = (): void => this.watchdog.feed(this.welcome?.heartbeatS ?? HEARTBEAT_S);
    heard();
    t.onControl = (frame) => {
      heard();
      this.meter.record(frame.length, performance.now());
      this.events.onIncoming?.();
      this.router.route(frame);
    };
    t.onDelivery = (bytes) => {
      heard();
      this.meter.record(bytes.length, performance.now());
      this.events.onIncoming?.();
      this.events.onDelivery(bytes);
    };
    t.onClose = (reason) => {
      if (this.transport === t) this.loseLink(reason);
    };
  }

  /** The transport is gone (closed, or silent): one status line and one disconnect, whichever notices first. */
  private loseLink(reason: string): void {
    const t = this.transport;
    if (!t || !this.live) return;
    this.live = false;
    this.watchdog.stop();
    this.events.onStatus('closed ' + reason);
    if (reason === 'silent') t.close(); // a half-open link never reports its own close
    if (!this.disposed && !this.fatal) this.events.onDisconnect?.(); // spec 8: POST /sesion + REANUDAR
  }

  dispose(): void {
    this.disposed = true;
    this.watchdog.stop();
    this.transport?.close();
    this.transport = null;
  }
}
