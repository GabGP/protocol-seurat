package seurat.adapters.in.inbox;

import java.io.Closeable;
import java.nio.file.Path;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.AuditLog;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.observe.Progress;
import seurat.core.works.catalog.Catalog;
import seurat.core.works.catalog.MasterNames;
import seurat.core.works.ingest.IngestJob;
import seurat.core.works.ingest.port.IngestPorts;

/** Master intake: inbox watch, zip unpack, single ingest (queue in {@link IntakeQueue},
 * edition swap through onEdition). */
public final class MasterIntake implements Closeable {
    private final Catalog catalog;
    private final SeuratConfig config;
    private final IngestPorts ports;
    private final InboxWatcher watcher;
    private final IntakeQueue queue;
    /** Called once a work's edition 2 is ready (LISTA): moves open canvases to it (spec 7.3). */
    private final Consumer<String> onEdition;

    public MasterIntake(Catalog catalog, SeuratConfig config, Executor ingest, IngestPorts ports,
            Consumer<String> onEdition) {
        this.catalog = catalog;
        this.config = config;
        this.ports = ports;
        this.onEdition = onEdition;
        this.watcher = new InboxWatcher(config.inbox, this::offer);
        this.queue = new IntakeQueue(catalog::isCompleted, ingest, ports.source()::isWhole, watcher, this::launch);
    }

    public void offer(String id, Path file) {
        queue.offer(id, file);
    }

    /**
     * An intake route published this file into inbox; offered through the watcher dedupe
     * so a missed WatchService event cannot strand it.
     */
    public void arrived(Path file) {
        watcher.arrived(file);
    }

    private void launch(String id, Path file) {
        try {
            if (ZipNames.isZip(file.toString())) {
                Progress.done(LogTags.work(id)); // the zip's own queued segment: its works take over
                // a work whose master is already home is resumed from there (watch), not unpacked again
                ZipIntake.run(file, w -> catalog.isCompleted(w) || ports.masters().find(w).isPresent(),
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
        Path master = ports.masters().adopt(id, file);
        new IngestJob(id, name, master, catalog, ports, () -> substitute(id), config.keepMaster).run();
    }

    private void substitute(String id) {
        onEdition.accept(id);
    }

    /** Boot: a pass cut short runs again from the master it left (spec 7.2), then the inbox. */
    public void watch() {
        ports.masters().unfinished(catalog).forEach(this::offer);
        watcher.start();
    }

    /** Stops the watcher and rejects new offers; running ingest drains. */
    @Override
    public void close() {
        queue.close();
        watcher.close();
    }
}
