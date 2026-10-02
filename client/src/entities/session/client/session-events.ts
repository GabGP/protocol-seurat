import type { Audit, Concession, PlanMsg, ProtocolError, Renew, Scrape, Welcome, WorkMessage, WorkOpened } from '@/shared/proto/messages';
import type { SessionInfo } from '../session-info';

/** What the session tells the app: one callback per server message, plus the link's own news. */
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
  /** POST /sesion answered: session info for the session about to start. */
  onSessionInfo?(info: SessionInfo): void;
  /** Any frame arrived, before it is handled: spec 5.2.2 checks expiry with every incoming message. */
  onIncoming?(): void;
}
