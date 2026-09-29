import type { SessionClient } from '@/entities/session';
import type { Account } from '@/entities/session';
import { HandleLedgers, type DeliverySink } from '@/entities/delivery';
import type { ImageTelemetry } from '@/entities/telemetry';
import type { Work } from '@/entities/work';
import type { GazeSender } from '@/features/send-gaze';
import type { PreviewManager } from '@/features/preview-works';
import { MAX_RETIRED_HANDLES } from '@/shared/config/constants';
import type { frameBatch } from '@/shared/lib/frame-batch';
import type { Concession, PlanMsg, ProtocolError, Welcome, WorkOpened } from '@/shared/proto/messages';

/** The React state the provider shows: the only way the session modules reach the UI. */
export interface Ui {
  setStatus(s: string): void;
  setAccount(a: Account): void;
  setWorks(w: Work[]): void;
  setWelcome(b: Welcome): void;
  setWorkOpened(a: WorkOpened | null): void;
  setConcession(c: Concession | null): void;
  setPlan(p: PlanMsg | null): void;
  setLastError(e: ProtocolError | null): void;
}

/** Everything the session modules share; the provider owns one and reads it back into its context. */
export interface Runtime {
  alive: boolean;
  ui: Ui;
  client: SessionClient | null;
  sink: DeliverySink | null;
  telemetry: ImageTelemetry | null;
  gaze: GazeSender | null;
  preview: PreviewManager | null;
  concession: Concession | null;
  works: Map<string, Work>;
  readonly ledgers: HandleLedgers;
  /** Handle whose book a REANUDAR is claiming, until BIENVENIDA says whether it was adopted. */
  resuming: number | null;
  /** Unsubscribe of the open sink's brush-cap listener (Settings > Max brushes applies live). */
  offBrushCap: (() => void) | null;
  bumpPaint: ReturnType<typeof frameBatch>;
}

export function createRuntime(ui: Ui, bumpPaint: ReturnType<typeof frameBatch>): Runtime {
  return {
    alive: true, ui, client: null, sink: null, telemetry: null, gaze: null, preview: null, concession: null,
    works: new Map(), ledgers: new HandleLedgers(MAX_RETIRED_HANDLES), resuming: null, offBrushCap: null, bumpPaint,
  };
}
