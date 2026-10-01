package seurat.adapters.in.inbox;

import java.nio.file.Path;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.BiConsumer;
import java.util.function.Predicate;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.Progress;
import seurat.core.works.ingest.decode.FormatMarkers;

/** Offers a master to the single ingest thread: skip a ready work, wait for the file, queue, run, release the inbox. */
final class IntakeQueue {
    private final Predicate<String> ready;
    private final Executor ingest;
    private final InboxWatcher watcher;
    private final BiConsumer<String, Path> launch;
    private volatile boolean closed;

    IntakeQueue(Predicate<String> ready, Executor ingest, InboxWatcher watcher, BiConsumer<String, Path> launch) {
        this.ready = ready;
        this.ingest = ingest;
        this.watcher = watcher;
        this.launch = launch;
    }

    static void skipped(String id) {
        Log.info(LogTags.INGEST, LogTags.work(id) + " skipped: already ready");
    }

    void offer(String id, Path file) {
        if (closed) {
            Log.info(LogTags.INGEST, LogTags.work(id) + " offer ignored: shutting down");
            return;
        }
        Thread.ofVirtual().start(() -> {
            if (!FormatMarkers.isZip(file.toString()) && ready.test(id)) {
                skipped(id);
                watcher.done(file);
                return;
            }
            if (!FileTransferWaiter.waitForReady(file)) {
                watcher.done(file);
                return;
            }
            Log.info(LogTags.INGEST, LogTags.work(id) + " ingest queued file=" + file.getFileName());
            Progress.queue(LogTags.INGEST, LogTags.work(id));
            try {
                ingest.execute(() -> {
                    try {
                        launch.accept(id, file);
                    } finally {
                        Progress.done(LogTags.work(id));
                        watcher.done(file);
                    }
                });
            } catch (RejectedExecutionException ex) {
                Log.info(LogTags.INGEST, LogTags.work(id) + " ingest dropped: shutting down");
                Progress.done(LogTags.work(id));
                watcher.done(file);
            }
        });
    }

    /** Rejects new offers; what already runs drains. */
    void close() {
        closed = true;
    }
}
