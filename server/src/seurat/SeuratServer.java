package seurat;

import java.nio.file.Path;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import seurat.adapters.in.inbox.MasterIntake;
import seurat.adapters.in.net.http.HttpSurface;
import seurat.adapters.in.net.socket.SocketServer;
import seurat.adapters.in.net.ws.WsMapping;
import seurat.adapters.out.decode.Decoders;
import seurat.adapters.out.disk.DiskArchive;
import seurat.adapters.out.disk.DiskMasters;
import seurat.adapters.out.disk.DiskStores;
import seurat.boot.Broadcast;
import seurat.boot.DiskReaper;
import seurat.boot.Shutdown;
import seurat.boot.Timers;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogLevel;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.Metrics;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.viewing.budget.BrushBudget;
import seurat.core.viewing.easel.Easel;
import seurat.core.viewing.easel.EaselContext;
import seurat.core.viewing.grant.EditionSwap;
import seurat.core.viewing.grant.GazeGate;
import seurat.core.viewing.grant.GrantController;
import seurat.core.viewing.grant.Liveness;
import seurat.core.viewing.grant.PolicySync;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.ingest.port.IngestPorts;

/** Wiring only: config, catalog, painter, mappings, timers. */
public final class SeuratServer {
    public static void main(String[] args) throws Exception {
        Path base = Path.of(args.length > 0 ? args[0] : ".");
        SeuratConfig config = SeuratConfig.load(base.resolve("seurat.conf"));
        Log.setLevel(LogLevel.fromString(config.logLevel, LogLevel.INFO));
        Log.info(LogTags.SERVER, "server starting protocol=Seurat/1 port=" + config.httpPort);
        Catalog catalog = new Catalog(new DiskArchive(config.works));
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
        EditionSwap swap = new EditionSwap(catalog, sessions, grants);
        MasterIntake intake = new MasterIntake(catalog, config, ingest,
                new IngestPorts(new Decoders(), new DiskStores(config.works), new DiskMasters(config.works)),
                id -> {
            if (swap.substitute(id)) {
                reaper.swapped(id); // ed1/ goes once no canvas uses it
            }
        });
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
