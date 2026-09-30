package seurat;

import java.nio.file.Path;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import seurat.app.Broadcast;
import seurat.app.DiskReaper;
import seurat.app.Shutdown;
import seurat.app.Timers;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.config.SeuratConfig;
import seurat.easel.Easel;
import seurat.easel.EaselContext;
import seurat.grant.GazeGate;
import seurat.grant.GrantController;
import seurat.grant.Liveness;
import seurat.grant.PolicySync;
import seurat.intake.MasterIntake;
import seurat.net.SocketServer;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;
import seurat.observe.LogLevel;
import seurat.observe.LogTags;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;
import seurat.session.Regulator;
import seurat.session.Session;
import seurat.session.Sessions;

/** Wiring only: config, catalog, painter, mappings, timers. */
public final class SeuratServer {
    public static void main(String[] args) throws Exception {
        Path base = Path.of(args.length > 0 ? args[0] : ".");
        SeuratConfig config = SeuratConfig.load(base.resolve("seurat.conf"));
        Log.setLevel(LogLevel.fromString(config.logLevel, LogLevel.INFO));
        Log.info(LogTags.SERVER, "server starting protocol=Seurat/1 port=" + config.httpPort);
        Catalog catalog = new Catalog(config.works);
        Sessions sessions = new Sessions();
        catalog.observe(new Broadcast(sessions));
        BrushBudget budget = new BrushBudget(config.coverage);
        catalog.observe(m -> {
            if (m.event() == ProtoCodes.OBRA_BAJA) {
                budget.forget(m.id()); // a withdrawn work keeps no buckets or coverage in memory
            }
        });
        catalog.load();
        catalog.all().forEach(w -> Log.info(LogTags.CATALOG, LogTags.work(w.meta.id()) + " loaded size=" + w.meta.width()
                + "x" + w.meta.height() + " strata=" + w.meta.strata()));
        Regulator regulator = new Regulator();
        Painter painter = new Painter(regulator, budget, new Metrics());
        GrantController grants = new GrantController(catalog, painter, sessions);
        GazeGate gazes = new GazeGate(grants);
        Liveness liveness = new Liveness(grants, sessions);
        PolicySync policies = new PolicySync(grants);
        DiskReaper reaper = new DiskReaper(config.works, sessions, catalog);
        Thread painterThread = Thread.ofPlatform().name("painter").daemon(true).unstarted(painter);
        painterThread.start();
        ExecutorService ingest = Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
        MasterIntake intake = new MasterIntake(catalog, sessions, grants, config, ingest);
        intake.onSwapped = reaper::swapped;
        HttpSurface http = new HttpSurface(base.resolve("client/dist"), sessions, catalog, config,
                intake::offer,
                id -> forEachCanvas(sessions, id, policies::apply),
                id -> {
                    catalog.withdraw(id);
                    forEachCanvas(sessions, id, grants::withdraw);
                    reaper.retired(id); // files go after the last canvas and book (spec 7.4)
                });
        intake.watch();
        ScheduledExecutorService clock = Timers.start(regulator, sessions, liveness, reaper, gazes);
        EaselContext ctx = new EaselContext(sessions, catalog, grants, gazes, config.sessionMaxBrushes,
                config.rateBytesPerSec);
        SocketServer listener = new SocketServer(config, http, (WsMapping mapping, BlockingQueue<byte[]> control) -> {
            Thread.ofVirtual().start(mapping::pump);
            Thread.ofVirtual().start(new Easel(mapping, control, ctx));
        });
        new Shutdown(listener, intake, sessions, clock, ingest, painter, painterThread).arm();
        listener.start();
    }

    private static void forEachCanvas(Sessions sessions, String id, java.util.function.Consumer<Canvas> action) {
        for (Session session : sessions.all()) {
            for (Canvas canvas : java.util.List.copyOf(session.canvases().values())) {
                if (canvas.workId().equals(id)) {
                    action.accept(canvas);
                }
            }
        }
    }
}
