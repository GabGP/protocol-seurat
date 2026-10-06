import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionClient, SessionInfo } from '@/entities/session';
import type { DeliverySink } from '@/entities/delivery';
import type { ImageTelemetry } from '@/entities/telemetry';
import type { Work } from '@/entities/work';
import type { GazeSender } from '@/features/send-gaze';
import type { Concession, PlanMsg, ProtocolError, Regulation, Welcome, WorkOpened } from '@/shared/proto/messages';
import { frameBatch } from '@/shared/lib/frame-batch';
import { createRuntime, type Runtime } from './seurat/runtime';
import { showPreviews } from './seurat/preview-cards';
import { closeWork } from './seurat/sink-lifecycle';
import { startSession } from './seurat/start-session';

export interface SeuratState {
  status: string;
  /** What POST /sesion said about this browser; null until the first session is issued. */
  session: SessionInfo | null;
  works: Work[];
  welcome: Welcome | null;
  opened: WorkOpened | null;
  concession: Concession | null;
  plan: PlanMsg | null;
  lastError: ProtocolError | null;
  /** The server is cutting this session (REGULACION); null when it is not. */
  regulation: Regulation | null;
  paintTick: number;
  client: SessionClient | null;
  sink: DeliverySink | null;
  telemetry: ImageTelemetry | null;
  gazeService: GazeSender | null;
  retryConnect(): void;
  closeWork(): void;
  /** The cards the gallery shows: only these hold a thumbnail. */
  showPreviews(ids: string[]): void;
}

const Ctx = createContext<SeuratState | null>(null);

export function useSeurat(): SeuratState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeurat outside provider');
  return v;
}

/** Holds the session's state for React; the protocol work lives in `./seurat`. */
export function SeuratProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState('boot');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [opened, setWorkOpened] = useState<WorkOpened | null>(null);
  const [concession, setConcession] = useState<Concession | null>(null);
  const [plan, setPlan] = useState<PlanMsg | null>(null);
  const [lastError, setLastError] = useState<ProtocolError | null>(null);
  const [regulation, setRegulation] = useState<Regulation | null>(null);
  const [paintTick, setPaintTick] = useState(0);
  const rtRef = useRef<Runtime | null>(null);
  rtRef.current ??= createRuntime(
    { setStatus, setSession, setWorks, setWelcome, setWorkOpened, setConcession, setPlan, setLastError, setRegulation },
    frameBatch(() => setPaintTick((t) => t + 1)),
  );
  const rt = rtRef.current;

  useEffect(() => startSession(rt), [rt]);

  const retryConnect = (): void => {
    setStatus('boot');
    setLastError(null);
    rt.client?.boot().then(
      () => {
        rt.client?.requestCatalog();
      },
      (e: unknown) => {
        setStatus('offline: ' + (e instanceof Error ? e.message : String(e)));
      },
    );
  };

  const value = useMemo<SeuratState>(
    () => ({
      status, session, works, welcome, opened, concession, plan, lastError, regulation, paintTick,
      client: rt.client, sink: rt.sink, telemetry: rt.telemetry, gazeService: rt.gaze,
      retryConnect, closeWork: () => closeWork(rt), showPreviews: (ids) => showPreviews(rt, ids),
    }),
    [status, session, works, welcome, opened, concession, plan, lastError, regulation, paintTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
