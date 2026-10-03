import { ErrorCode, MANDATORY_TYPE_LIMIT } from '@/shared/config/constants';
import {
  T,
  auditDecode,
  concessionDecode,
  errorCore,
  errorDecode,
  goodbyeDecode,
  heartbeatCore,
  openedDecode,
  planDecode,
  regulationDecode,
  renewDecode,
  scrapeDecode,
  welcomeDecode,
  workDecode,
  type Welcome,
} from '@/shared/proto/messages';
import { encodeFrame, FatalProtocolError, splitAll } from '@/shared/proto/frame';
import { u64Decode } from '@/shared/proto/varint';
import { persistResume } from '../store';
import type { OpenQueue } from './open-queue';
import type { SessionEvents } from './session-events';

/** What the router needs from the session that owns the link. */
export interface RouterHost {
  send(frame: Uint8Array): void;
  close(): void;
  /** BIENVENIDA arrived. */
  welcomed(b: Welcome): void;
  /** A fatal ERROR ended the session: no REANUDAR, a fresh start is needed. */
  markFatal(): void;
}

/** Decodes every server control frame and hands it to the app; a malformed or unknown mandatory one is fatal. */
export class ControlRouter {
  constructor(
    private readonly events: SessionEvents,
    private readonly opens: OpenQueue,
    private readonly host: RouterHost,
  ) {}

  route(frame: Uint8Array): void {
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
    this.host.send(encodeFrame(T.ERROR, errorCore({ code: ErrorCode.PROTOCOL, fatal: 1, refType, msg: msg.slice(0, 120) })));
    this.host.markFatal();
    this.host.close();
    this.events.onStatus('protocol error: ' + msg);
  }

  private dispatch(type: number, payload: Uint8Array): void {
    const ev = this.events;
    switch (type) {
      case T.BIENVENIDA: {
        const b = welcomeDecode(payload);
        this.host.welcomed(b);
        if (b.ticket.length === 32 && b.sessionId !== null) persistResume(b.sessionId, b.ticket);
        ev.onWelcome(b);
        break;
      }
      case T.LATIDO:
        this.host.send(encodeFrame(T.ECO, heartbeatCore(u64Decode(payload, 0).value)));
        break;
      case T.ADIOS:
        goodbyeDecode(payload);
        this.host.close(); // orderly close by the server; the book survives L + delta (REANUDAR)
        ev.onStatus('adios');
        break;
      case T.ERROR: {
        const err = errorDecode(payload);
        if (err.fatal === 1) this.host.markFatal();
        const req = this.opens.length > 0 && err.refType === T.ABRIR ? this.opens.shift() : undefined;
        if (req?.preview) ev.onPreviewError?.(req.id, err);
        else ev.onProtocolError(err);
        break;
      }
      case T.OBRA:
        ev.onWork(workDecode(payload));
        break;
      case T.ABIERTA: {
        const a = openedDecode(payload);
        const req = this.opens.shift();
        if (req?.preview) ev.onPreviewWorkOpened?.(req.id, a);
        else ev.onWorkOpened(a);
        break;
      }
      case T.CONCESION:
        ev.onConcession(concessionDecode(payload));
        break;
      case T.PLAN:
        ev.onPlan(planDecode(payload));
        break;
      case T.RASPAR:
        ev.onScrape(scrapeDecode(payload));
        break;
      case T.RENOVAR:
        ev.onRenew(renewDecode(payload));
        break;
      case T.AUDITAR:
        ev.onAudit(auditDecode(payload));
        break;
      case T.REGULACION:
        ev.onRegulation?.(regulationDecode(payload));
        break;
      default:
        // C->S types (SALUDO, MIRADA, RECIBO…) are as invalid here as unknown ones below 0x40.
        if (type < MANDATORY_TYPE_LIMIT) throw new FatalProtocolError('unexpected mandatory type 0x' + type.toString(16));
        break;
    }
  }
}
