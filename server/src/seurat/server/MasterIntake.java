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
import seurat.observe.AuditLog;
import seurat.observe.Log;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;
import seurat.session.Concession;
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
            Log.info("ingest", "Shutdown in progress, ignoring offer for '" + id + "'");
            return;
        }
        Thread.ofVirtual().start(() -> {
            if (!file.toString().endsWith(".zip") && isLista(id)) {
                Log.info("ingest", "Work already completed, skipping: " + id);
                watcher.done(file);
                return;
            }
            if (!FileTransferWaiter.waitForReady(file)) {
                watcher.done(file);
                return;
            }
            Log.info("ingest", "Queueing ingest for '" + id + "' (" + file.getFileName() + ")");
            try {
                ingest.execute(() -> {
                    try {
                        launch(id, file);
                    } finally {
                        watcher.done(file);
                    }
                });
            } catch (RejectedExecutionException ex) {
                Log.info("ingest", "Shutdown in progress, dropping ingest for '" + id + "'");
                watcher.done(file);
            }
        });
    }

    private void launch(String id, Path file) {
        try {
            if (file.toString().endsWith(".zip")) {
                Log.info("ingest", "Unpacking zip archive: " + file.getFileName());
                List<Path> imgs = ZipUnpacker.unpack(file, this::isLista);
                if (imgs.isEmpty()) {
                    Log.info("ingest", "Zip archive " + file.getFileName() + " has no new works to ingest");
                    return;
                }
                Log.info("ingest", "Ingesting " + imgs.size() + " work(s) from " + file.getFileName());
                long batchStart = System.currentTimeMillis();
                for (Path img : imgs) {
                    String name = img.getFileName().toString().replaceAll("\\.[^.]+$", "");
                    new IngestJob(name, name, img, config.works, catalog,
                            () -> substitute(name)).run();
                }
                if (imgs.size() > 1) {
                    long batchElapsed = System.currentTimeMillis() - batchStart;
                    Log.info("ingest", "Batch preprocessing for " + file.getFileName()
                            + " completed in " + IngestJob.formatDuration(batchElapsed));
                }
                return;
            }
            String name = file.getFileName().toString().replaceAll("\\.[^.]+$", "");
            if (isLista(id)) {
                Log.info("ingest", "Work already completed, skipping: " + id);
                return;
            }
            new IngestJob(id, name, file, config.works, catalog,
                    () -> substitute(id)).run();
        } catch (Throwable ex) {
            Log.error("ingest", "Ingest failed for " + id + ": " + ex.getMessage(), ex);
            try {
                AuditLog.alert("ingest failed " + id + ": " + ex.getMessage());
            } catch (Throwable ignored) {
            }
        }
    }

    private boolean isLista(String id) {
        return catalog.isCompleted(id);
    }

    /** Edition swap: point canvases at ed2, re-issue concession, replan without withdrawing. */
    private void substitute(String id) {
        WorkRecord work = catalog.get(id);
        if (work == null) return;
        Log.info("ingest", "Swapping edition for work '" + id + "' across active canvases");
        for (Session session : sessions.all()) {
            for (Canvas canvas : session.canvases().values()) {
                if (!canvas.workId().equals(id)) continue;
                canvas.setStore(work.store, work.meta);
                long[] c = work.ceiling(session.role());
                Concession prev = canvas.concession();
                canvas.setConcession(new Concession(prev.epoch() + 1, (int) c[0], (int) c[1],
                        ProtoCodes.MOT_POLITICA, prev.maxBrushes(), prev.maxKiB(), prev.leaseS()));
                if (canvas.gaze() != null) grants.gaze(session, canvas, canvas.gaze());
                else grants.open(session, canvas);
            }
        }
    }

    public void watch() {
        watcher.start();
    }

    /** Stops the watcher and rejects new offers; running ingest drains. */
    @Override
    public void close() {
        closed = true;
        watcher.close();
    }
}
