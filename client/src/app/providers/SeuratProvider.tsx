import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Account, SessionClient } from '@/entities/session';
import type { DeliverySink } from '@/entities/delivery';
import type { ImageTelemetry } from '@/entities/telemetry';
import type { Work } from '@/entities/work';
import type { GazeSender } from '@/features/send-gaze';
import type { Concession, PlanMsg, ProtocolError, Welcome, WorkOpened } from '@/shared/proto/messages';
import { frameBatch } from '@/shared/lib/frame-batch';
import { createRuntime, type Runtime } from './seurat/runtime';
import { showPreviews } from './seurat/preview-cards';
import { closeWork } from './seurat/sink-lifecycle';
import { startSession } from './seurat/start-session';

export interface SeuratState {
  status: string;
  /** Who the current session is (POST /sesion); null until the first one is issued. */
  account: Account | null;
  works: Work[];
  welcome: Welcome | null;
  opened: WorkOpened | null;
  concession: Concession | null;
  plan: PlanMsg | null;
  lastError: ProtocolError | null;
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
  const [account, setAccount] = useState<Account | null>(null);
  const [works, setWorks] = useState<Work[]>([]);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [opened, setWorkOpened] = useState<WorkOpened | null>(null);
  const [concession, setConcession] = useState<Concession | null>(null);
  const [plan, setPlan] = useState<PlanMsg | null>(null);
  const [lastError, setLastError] = useState<ProtocolError | null>(null);
  const [paintTick, setPaintTick] = useState(0);
  const rtRef = useRef<Runtime | null>(null);
  rtRef.current ??= createRuntime(
    { setStatus, setAccount, setWorks, setWelcome, setWorkOpened, setConcession, setPlan, setLastError },
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
      status, account, works, welcome, opened, concession, plan, lastError, paintTick,
      client: rt.client, sink: rt.sink, telemetry: rt.telemetry, gazeService: rt.gaze,
      retryConnect, closeWork: () => closeWork(rt), showPreviews: (ids) => showPreviews(rt, ids),
    }),
    [status, account, works, welcome, opened, concession, plan, lastError, paintTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
