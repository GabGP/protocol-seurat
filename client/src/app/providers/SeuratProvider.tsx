import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SessionClient, type SessionEvents } from './session-client';
import { DeliverySink } from './delivery-sink';
import { HandleLedgers } from '@/entities/delivery/ledgers';
import { parseBrushHead, splitBrushId } from '@/shared/proto/brush';
import { MAX_RETIRED_HANDLES, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '@/shared/config/constants';
import { ownedDeliveries } from '@/entities/delivery/store';
import { T } from '@/shared/proto/messages';
import { clearResume } from '@/entities/session/store';
import type { Account } from '@/entities/session/access-key';
import { applyWork, sortWorks } from '@/entities/work/store';
import type { Work } from '@/entities/work/types';
import type { WorkOpened, Welcome, Concession, PlanMsg, ProtocolError } from '@/shared/proto/messages';
import { GazeSender } from '@/features/send-gaze';
import { PreviewManager } from '@/features/preview-works';
import { ImageTelemetry } from '@/entities/telemetry/image-telemetry';
import { frameBatch } from '@/shared/lib/frame-batch';

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
}

const Ctx = createContext<SeuratState | null>(null);

export function useSeurat(): SeuratState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSeurat outside provider');
  return v;
}

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
  const clientRef = useRef<SessionClient | null>(null);
  const sinkRef = useRef<DeliverySink | null>(null);
  const telemetryRef = useRef<ImageTelemetry | null>(null);
  const ledgersRef = useRef(new HandleLedgers(MAX_RETIRED_HANDLES));
  const gazesRef = useRef<GazeSender | null>(null);
  const worksRef = useRef(new Map<string, Work>());
  const previewRef = useRef<PreviewManager | null>(null);

  useEffect(() => {
    let alive = true;
    const bumpPaint = frameBatch(() => setPaintTick((t) => t + 1));
    const preview = new PreviewManager(() => clientRef.current);
    previewRef.current = preview;
    /** Handle whose book a REANUDAR is claiming, until BIENVENIDA says whether it was adopted. */
    let resuming: number | null = null;
    let retries = 0;
    const reconnect = (): void => {
      if (!alive) return;
      const sink = sinkRef.current;
      resuming = sink?.handle ?? null;
      previewRef.current?.dispose();
      previewRef.current = new PreviewManager(() => clientRef.current);
      client.boot(sink ? [{ handle: sink.handle, ranges: ownedDeliveries(sink.book) }] : []).then(
        () => {
          retries = 0;
          client.requestCatalog();
        },
        () => {
          retries += 1;
          window.setTimeout(reconnect, Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** retries));
        },
      );
    };
    const events: SessionEvents = {
      onWelcome: (b) => {
        const kept = resuming !== null && b.resumed.includes(resuming) && sinkRef.current?.handle === resuming;
        resuming = null;
        if (kept) {
          sinkRef.current?.resumed(); // spec 3.4.4: the book is adopted, nothing is downloaded again
          gazesRef.current?.again();
          return;
        }
        if (sinkRef.current) {
          sinkRef.current.dispose(); // not adopted: empty the canvas, the viewer reopens it from the sketch
          sinkRef.current = null;
          setWorkOpened(null);
        }
        if (alive) setWelcome(b);
      },
      onDisconnect: () => reconnect(),
      onAccount: (a) => {
        if (alive) setAccount(a);
      },
      onWork: (m) => {
        worksRef.current = applyWork(worksRef.current, m);
        const list = sortWorks([...worksRef.current.values()]);
        if (alive) {
          setWorks(list);
          const readyIds = list
            .filter((w) => w.state === 1 || w.state === 3)
            .map((w) => w.id);
          previewRef.current?.enqueue(readyIds);
        }
      },
      onWorkOpened: (a) => {
        if (!alive) return;
        previewRef.current?.pause();
        if (sinkRef.current && sinkRef.current.handle !== a.handle) {
          const prev = sinkRef.current.handle;
          ledgersRef.current.adopt(prev, sinkRef.current.book);
          sinkRef.current.dispose();
          clientRef.current?.closeHandle(prev);
        }
        setWorkOpened(a);
        const sink = new DeliverySink(
          a.handle,
          () => clientRef.current,
          () => concessionRef.current?.maxKiB ?? 36864,
          () => concessionRef.current?.maxBrushes ?? 768,
          a.seedWidth,
          a.seedHeight,
          a.strata,
        );
        sinkRef.current = sink;
        telemetryRef.current = new ImageTelemetry(a.handle, performance.now());
      },
      onPreviewWorkOpened: (id, a) => {
        previewRef.current?.onWorkOpened(id, a);
      },
      onPreviewError: (id) => {
        previewRef.current?.onError(id);
      },
      onConcession: (c) => {
        if (sinkRef.current && sinkRef.current.handle !== c.handle) return;
        concessionRef.current = c;
        sinkRef.current?.concede({ epoch: c.epoch, minStratum: c.minStratum, maxBands: c.maxBands });
        if (alive) setConcession(c);
      },
      onPlan: (p) => {
        if (telemetryRef.current?.handle === p.handle) telemetryRef.current.onPlan(p, performance.now());
        if (sinkRef.current?.handle === p.handle) {
          if (p.event === 0) sinkRef.current.planStart(p.first, p.gazeSeq);
          if (alive) setPlan(p);
          if (p.event === 2) sinkRef.current?.applyPlanCanceladas(p.cancelled);
        } else if (p.event === 2) {
          ledgersRef.current.canceladas(p.handle, p.cancelled);
        }
      },
      onScrape: (r) => {
        if (previewRef.current?.onScrape(r)) return;
        if (sinkRef.current?.handle === r.handle) {
          sinkRef.current.applyScrape(r, () => performance.now());
          if (alive) bumpPaint();
        } else {
          const res = ledgersRef.current.applyScrape(r);
          clientRef.current?.sendScraped(r.handle, r.order, r.epoch, r.through, res.scraped, res.kib, res.keep);
        }
      },
      onRenew: (r) => {
        if (previewRef.current?.onRenew(r)) return;
        if (sinkRef.current?.handle !== r.handle) return;
        sinkRef.current?.applyRenew(r.ranges, r.order, r.leaseS, () => performance.now());
      },
      onAudit: (a) => {
        if (previewRef.current?.onAudit(a)) return;
        const inv = sinkRef.current?.handle === a.handle
          ? sinkRef.current?.inventory(a.through)
          : ledgersRef.current.inventory(a.handle, a.through);
        if (inv && clientRef.current) {
          clientRef.current.sendInventory(a.handle, a.order, a.through, inv.brushCount, inv.kib, inv.ranges);
        }
      },
      onProtocolError: (e) => {
        // 12: resume rejected; 4 after a RASPAR TODO: the work was withdrawn and the handle is dead (spec 7.4).
        if (e.code === 12 || (e.code === 4 && e.refType !== T.ABRIR && sinkRef.current?.withdrawn)) {
          clearResume();
          sinkRef.current?.dispose();
          sinkRef.current = null;
          telemetryRef.current = null;
          setWorkOpened(null);
          setConcession(null);
          previewRef.current?.resume();
        }
        if (alive) setLastError(e);
      },
      onDelivery: (bytes) => {
        try {
          const h = parseBrushHead(bytes);
          if (telemetryRef.current?.handle === h.handle) {
            telemetryRef.current.onDelivery(bytes.length, h.delivery, performance.now());
          }
          if (sinkRef.current?.handle !== h.handle && !previewRef.current?.owns(h.handle)) {
            const split = splitBrushId(h.brushId);
            let bandBytes = 0;
            for (const n of h.lengths) bandBytes += n;
            ledgersRef.current.record(h.handle, {
              delivery: h.delivery,
              brushId: h.brushId,
              stratum: split.stratum,
              from: h.from,
              through: h.through,
              bytes: bandBytes,
              epoch: h.epoch,
              edition: h.edition,
              expires: 0,
              rgba: null,
            });
          }
        } catch {
          /* unparseable frame: sink/preview paths reject it too */
        }
        if (previewRef.current?.onDelivery(bytes)) return;
        sinkRef.current?.ingest(bytes, () => performance.now(), () => {
          if (alive) bumpPaint();
        }, concessionRef.current?.leaseS ?? 120);
      },
      onStatus: (s) => {
        if (alive) setStatus(s);
      },
    };
    const concessionRef: { current: Concession | null } = { current: null };
    const client = new SessionClient(events);
    clientRef.current = client;
    gazesRef.current = new GazeSender(() => clientRef.current?.activeTransport ?? null);
    client.boot().then(
      () => {
        if (alive) client.requestCatalog();
      },
      (e: unknown) => {
        if (alive) setStatus('offline: ' + (e instanceof Error ? e.message : String(e)));
      },
    );
    // pagehide sends nothing (spec 5.3): the book survives L + delta and pageshow resumes it.
    // visibilitychange -> MIRADA OCULTA is sent by the viewer (useViewerWork).
    const sweep = window.setInterval(() => {
      sinkRef.current?.sweepExpiry(() => performance.now());
      previewRef.current?.sweep(performance.now());
    }, 1000);
    return () => {
      alive = false;
      bumpPaint.cancel();
      window.clearInterval(sweep);
      gazesRef.current?.dispose();
      previewRef.current?.dispose();
      previewRef.current = null;
      sinkRef.current?.dispose();
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  const retryConnect = (): void => {
    setStatus('boot');
    setLastError(null);
    clientRef.current?.boot().then(
      () => {
        clientRef.current?.requestCatalog();
      },
      (e: unknown) => {
        setStatus('offline: ' + (e instanceof Error ? e.message : String(e)));
      },
    );
  };

  const closeWork = (): void => {
    if (sinkRef.current) {
      const h = sinkRef.current.handle;
      ledgersRef.current.adopt(h, sinkRef.current.book);
      sinkRef.current.dispose();
      sinkRef.current = null;
      clientRef.current?.closeHandle(h);
    }
    telemetryRef.current = null;
    setWorkOpened(null);
    setConcession(null);
    setPlan(null);
    previewRef.current?.resume();
  };

  const value = useMemo<SeuratState>(
    () => ({
      status, account, works, welcome, opened, concession, plan, lastError, paintTick,
      client: clientRef.current, sink: sinkRef.current, telemetry: telemetryRef.current,
      gazeService: gazesRef.current,
      retryConnect, closeWork,
    }),
    [status, account, works, welcome, opened, concession, plan, lastError, paintTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
