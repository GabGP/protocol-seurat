package seurat.intake;

import java.io.Closeable;
import java.nio.file.Path;
import java.util.concurrent.Executor;
import seurat.catalog.Catalog;
import seurat.grant.GrantController;
import seurat.config.SeuratConfig;
import seurat.ingest.IngestJob;
import seurat.ingest.MasterHome;
import seurat.ingest.decode.FormatMarkers;
import seurat.store.MasterNames;
import seurat.observe.AuditLog;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.observe.Progress;
import seurat.session.Sessions;

/** Master intake: inbox watch, zip unpack, single ingest (queue in {@link IntakeQueue}, swap in {@link EditionSwap}). */
public final class MasterIntake implements Closeable {
    private final Catalog catalog;
    private final SeuratConfig config;
    private final InboxWatcher watcher;
    private final IntakeQueue queue;
    private final EditionSwap swap;
    /** After the swap: ed1/ is deleted once no canvas uses it (DiskReaper). */
    public volatile java.util.function.Consumer<String> onSwapped;

    public MasterIntake(Catalog catalog, Sessions sessions, GrantController grants,
            SeuratConfig config, Executor ingest) {
        this.catalog = catalog;
        this.config = config;
        this.swap = new EditionSwap(catalog, sessions, grants);
        this.watcher = new InboxWatcher(config.inbox, this::offer);
        this.queue = new IntakeQueue(catalog::isCompleted, ingest, watcher, this::launch);
    }

    public void offer(String id, Path file) {
        queue.offer(id, file);
    }

    private void launch(String id, Path file) {
        try {
            if (FormatMarkers.isZip(file.toString())) {
                Progress.done(LogTags.work(id)); // the zip's own queued segment: its works take over
                // a work whose master is already home is resumed from there (watch), not unpacked again
                ZipIntake.run(file, w -> catalog.isCompleted(w) || MasterHome.find(config.works, w).isPresent(),
                        this::ingest);
                return;
            }
            ingest(id, MasterNames.stem(file.getFileName().toString()), file);
        } catch (Throwable ex) {
            AuditLog.alert(LogTags.work(id) + " ingest failed: " + LogUnits.cause(ex), ex);
        }
    }

    /** Spec 1.2: the master moves to obras/<id>/master/ before the one pass reads it. */
    private void ingest(String id, String name, Path file) throws Exception {
        if (catalog.isCompleted(id)) {
            IntakeQueue.skipped(id);
            return;
        }
        Path master = MasterHome.adopt(config.works, id, file);
        new IngestJob(id, name, master, config.works, catalog, () -> substitute(id), config.keepMaster).run();
    }

    private void substitute(String id) {
        if (swap.substitute(id) && onSwapped != null) {
            onSwapped.accept(id);
        }
    }

    /** Boot: a pass cut short runs again from the master it left (spec 7.2), then the inbox. */
    public void watch() {
        MasterHome.unfinished(catalog, config.works).forEach(this::offer);
        watcher.start();
    }

    /** Stops the watcher and rejects new offers; running ingest drains. */
    @Override
    public void close() {
        queue.close();
        watcher.close();
    }
}
