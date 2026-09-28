package seurat.server;

import java.io.Closeable;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.concession.GrantController;
import seurat.config.SeuratConfig;
import seurat.ingest.IngestJob;
import seurat.ingest.MasterHome;
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.observe.LogUnits;
import seurat.session.Canvas;
import seurat.session.Session;
import seurat.session.Sessions;

/** Master intake: inbox watch, zip unpack, single ingest, ed1->ed2 swap. */
public final class MasterIntake implements Closeable {
    private final Catalog catalog;
    private final Sessions sessions;
    private final GrantController grants;
    private final SeuratConfig config;
    private final Executor ingest;
    private final InboxWatcher watcher;
    private volatile boolean closed;
    /** After the swap: ed1/ is deleted once no canvas uses it (DiskReaper). */
    public volatile java.util.function.Consumer<String> onSwapped;

    public MasterIntake(Catalog catalog, Sessions sessions, GrantController grants,
            SeuratConfig config, Executor ingest) {
        this.catalog = catalog;
        this.sessions = sessions;
        this.grants = grants;
        this.config = config;
        this.ingest = ingest;
        this.watcher = new InboxWatcher(config.inbox, this::offer);
    }

    public void offer(String id, Path file) {
        if (closed) {
            Log.info("ingest", "work=" + id + " offer ignored: shutting down");
            return;
        }
        Thread.ofVirtual().start(() -> {
            if (!file.toString().endsWith(".zip") && isLista(id)) {
                skipped(id);
                watcher.done(file);
                return;
            }
            if (!FileTransferWaiter.waitForReady(file)) {
                watcher.done(file);
                return;
            }
            Log.info("ingest", "work=" + id + " ingest queued file=" + file.getFileName());
            try {
                ingest.execute(() -> {
                    try {
                        launch(id, file);
                    } finally {
                        watcher.done(file);
                    }
                });
            } catch (RejectedExecutionException ex) {
                Log.info("ingest", "work=" + id + " ingest dropped: shutting down");
                watcher.done(file);
            }
        });
    }

    private void launch(String id, Path file) {
        try {
            if (file.toString().endsWith(".zip")) {
                Log.info("ingest", "zip=" + file.getFileName() + " unpack started");
                // a work whose master is already home is resumed from there (watch), not unpacked again
                List<Path> imgs = ZipUnpacker.unpack(file,
                        w -> isLista(w) || MasterHome.find(config.works, w).isPresent());
                if (imgs.isEmpty()) {
                    return; // ZipUnpacker said why: up to date or unreadable
                }
                Log.info("ingest", "zip=" + file.getFileName() + " ingest started works=" + imgs.size());
                long batchStart = System.currentTimeMillis();
                for (Path img : imgs) {
                    String name = img.getFileName().toString().replaceAll("\\.[^.]+$", "");
                    ingest(name, name, img);
                }
                if (imgs.size() > 1) {
                    Log.info("ingest", "zip=" + file.getFileName() + " ingest done works=" + imgs.size()
                            + " took=" + LogUnits.duration(System.currentTimeMillis() - batchStart));
                }
                return;
            }
            ingest(id, file.getFileName().toString().replaceAll("\\.[^.]+$", ""), file);
        } catch (Throwable ex) {
            AuditLog.alert("work=" + id + " ingest failed: " + LogUnits.cause(ex), ex);
        }
    }

    /** Spec 1.2: the master moves to obras/<id>/master/ before the one pass reads it. */
    private void ingest(String id, String name, Path file) throws Exception {
        if (isLista(id)) {
            skipped(id);
            return;
        }
        Path master = MasterHome.adopt(config.works, id, file);
        new IngestJob(id, name, master, config.works, catalog, () -> substitute(id), config.keepMaster).run();
    }

    private boolean isLista(String id) {
        return catalog.isCompleted(id);
    }

    private static void skipped(String id) {
        Log.info("ingest", "work=" + id + " skipped: already ready");
    }

    /** Edition swap (spec 7.1 [6], 7.3): every open canvas of the work moves to ed2. */
    private void substitute(String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) return;
        Log.info("ingest", "work=" + id + " edition swap ed=" + work.meta.edition());
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (canvas.workId().equals(id) && canvas.meta().edition() != work.meta.edition()) {
                    grants.substitute(canvas, work);
                }
            }
        }
        if (onSwapped != null) onSwapped.accept(id);
    }

    /** Boot: a pass cut short runs again from the master it left (spec 7.2), then the inbox. */
    public void watch() {
        MasterHome.unfinished(catalog, config.works).forEach(this::offer);
        watcher.start();
    }

    /** Stops the watcher and rejects new offers; running ingest drains. */
    @Override
    public void close() {
        closed = true;
        watcher.close();
    }
}
