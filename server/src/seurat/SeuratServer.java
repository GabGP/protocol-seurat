package seurat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.concession.Liveness;
import seurat.concession.PolicySync;
import seurat.config.SeuratConfig;
import seurat.net.SocketServer;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;
import seurat.observe.LogLevel;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgHandshake;
import seurat.proto.ProtoCodes;
import seurat.regulate.Regulator;
import seurat.server.MasterIntake;
import seurat.server.Shutdown;
import seurat.session.Canvas;
import seurat.session.Easel;
import seurat.session.Session;
import seurat.session.Sessions;

/** Wiring only: config, catalog, painter, mappings, timers. */
public final class SeuratServer {
    public static void main(String[] args) throws Exception {
        Path base = Path.of(args.length > 0 ? args[0] : ".");
        SeuratConfig config = SeuratConfig.load(base.resolve("seurat.conf"));
        Log.setLevel(LogLevel.fromString(config.logLevel, LogLevel.INFO));
        Log.info("server", "Starting Seurat/1 server on port " + config.httpPort);
        Catalog catalog = new Catalog(config.works);
        catalog.observe(msg -> Log.info("catalog", "Work '" + msg.id() + "' "
                + ProtoCodes.eventName(msg.event()) + " (" + msg.progress() + "% ed=" + msg.edition() + ")"));
        catalog.load();
        int workCount = 0;
        for (WorkRecord w : catalog.all()) {
            workCount++;
            Log.info("catalog", "Loaded: " + w.meta.id() + " [" + w.meta.name() + "] ("
                    + w.meta.width() + "x" + w.meta.height() + ", strata=" + w.meta.strata() + ")");
        }
        Log.info("catalog", "Catalog ready with " + workCount + " work(s)");
        BrushBudget budget = new BrushBudget(config.coverage);
        Regulator regulator = new Regulator();
        Metrics metrics = new Metrics();
        Painter painter = new Painter(regulator, budget, metrics);
        Sessions sessions = new Sessions();
        GrantController grants = new GrantController(catalog, painter, sessions);
        Liveness liveness = new Liveness(grants, sessions);
        PolicySync policies = new PolicySync(grants);
        Thread painterThread = Thread.ofPlatform().name("painter").daemon(true).unstarted(painter);
        painterThread.start();
        ExecutorService ingest = Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
        MasterIntake intake = new MasterIntake(catalog, sessions, grants, config, ingest);
        Path root = staticRoot(base);
        HttpSurface http = new HttpSurface(root, sessions, catalog, config,
                intake::offer,
                id -> applyPolicy(catalog, sessions, policies, id),
                id -> withdraw(catalog, sessions, grants, config, id));
        intake.watch();
        ScheduledExecutorService clock = Executors.newSingleThreadScheduledExecutor();
        clock.scheduleAtFixedRate(() -> regulator.tick(sessions.all()), 250, 250, TimeUnit.MILLISECONDS);
        clock.scheduleAtFixedRate(liveness::tick, 1, 1, TimeUnit.SECONDS);
        clock.scheduleAtFixedRate(() -> heartbeat(sessions), 15, 15, TimeUnit.SECONDS);
        Log.info("server", "Listening on http://localhost:" + config.httpPort + " (root=" + root + ")");
        Log.info("server", "Press Ctrl+C for graceful shutdown");
        SocketServer listener = new SocketServer(config.httpPort, http, (WsMapping mapping,
                BlockingQueue<byte[]> control) -> {
            Thread.ofVirtual().start(mapping::pump);
            Thread.ofVirtual().start(new Easel(mapping, control, sessions, catalog,
                    grants, painter, config.sessionMaxBrushes));
        });
        new Shutdown(listener, intake, sessions, clock, ingest, painter, painterThread).arm();
        listener.start();
    }

    private static Path staticRoot(Path base) {
        return base.resolve("client/dist");
    }

    private static void applyPolicy(Catalog catalog, Sessions sessions,
            PolicySync policies, String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) return;
        Log.info("server", "Applying policy update for work '" + id + "'");
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (canvas.workId().equals(id)) {
                    policies.apply(canvas, work.ceiling(session.role()));
                }
            }
        }
    }

    private static void withdraw(Catalog catalog, Sessions sessions,
            GrantController grants, SeuratConfig config, String id) {
        Log.info("server", "Withdrawing work '" + id + "'");
        catalog.withdraw(id);
        for (Session session : sessions.all()) {
            for (Canvas canvas : new ArrayList<>(session.canvases().values())) {
                if (canvas.workId().equals(id)) {
                    grants.withdraw(canvas);
                }
            }
        }
        deleteRecursively(config.works.resolve(id));
    }

    private static void heartbeat(Sessions sessions) {
        for (Session session : sessions.all()) {
            try {
                session.mapping().sendControl(new Frame(FrameType.LATIDO,
                        new MsgHandshake.Heartbeat(System.nanoTime()).encode()).encode());
            } catch (Exception ex) {
                Log.debug("server", "Heartbeat send error to session " + session.id());
            }
        }
    }

    private static void deleteRecursively(Path dir) {
        if (!Files.exists(dir)) return;
        try (var walk = Files.walk(dir)) {
            for (Path p : walk.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(p);
            }
        } catch (Exception ignored) {}
    }
}
