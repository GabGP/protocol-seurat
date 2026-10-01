package seurat.adapters.in.inbox;

import java.nio.file.ClosedWatchServiceException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardWatchEventKinds;
import java.nio.file.WatchKey;
import java.nio.file.WatchService;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import seurat.core.shared.observe.AuditLog;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.works.ingest.MasterFormats;

/** Watches inbox directory and scans for incoming master images and archives. */
public final class InboxWatcher {
    private final Path inbox;
    private final BiConsumer<String, Path> onMaster;
    private final Set<Path> seen = ConcurrentHashMap.newKeySet();
    private volatile WatchService watch;
    private volatile boolean closed;

    public InboxWatcher(Path inbox, BiConsumer<String, Path> onMaster) {
        this.inbox = inbox;
        this.onMaster = onMaster;
    }

    public void start() {
        Thread.ofVirtual().start(() -> {
            if (closed) return;
            try {
                scan(inbox);
                var watcher = inbox.getFileSystem().newWatchService();
                watch = watcher;
                inbox.register(watcher, StandardWatchEventKinds.ENTRY_CREATE,
                        StandardWatchEventKinds.ENTRY_MODIFY);
                Log.info(LogTags.INGEST, "inbox watching path=" + inbox.toAbsolutePath());
                for (;;) {
                    var key = takeQuietly(watcher);
                    if (key == null) return;
                    for (var event : key.pollEvents()) {
                        offerIfMaster(event.context().toString());
                    }
                    key.reset();
                }
            } catch (Throwable ex) {
                AuditLog.alert("inbox watch failed: " + LogUnits.cause(ex), ex);
            }
        });
    }

    /** Null on shutdown: take() throws when the service is closed. */
    private WatchKey takeQuietly(WatchService watcher) throws Exception {
        try {
            return watcher.take();
        } catch (ClosedWatchServiceException ex) {
            if (closed) {
                Log.info(LogTags.INGEST, "inbox watch stopped");
                return null;
            }
            throw ex;
        }
    }

    /** Stops the watcher thread; in-flight ingest drains on its pool. */
    public void close() {
        closed = true;
        try {
            if (watch != null) watch.close();
        } catch (Exception ignored) {
        }
    }

    void scan(Path root) {
        if (!Files.exists(root)) return;
        try (var walk = Files.walk(root)) {
            for (Path file : walk.filter(Files::isRegularFile).toList()) {
                String rel = root.relativize(file).toString().replace('\\', '/');
                if (rel.contains(".d/") || rel.startsWith(".d/")) continue;
                if (MasterFormats.isAdmitted(file.getFileName().toString())) {
                    submit(rel.replaceAll("\\.[^.]+$", ""), file);
                }
            }
        } catch (Throwable ex) {
            Log.error(LogTags.INGEST, "inbox scan failed path=" + root + ": " + LogUnits.cause(ex));
        }
    }

    private void offerIfMaster(String name) {
        if (name.endsWith(".d") || name.endsWith(".tmp") || name.contains(".d/")) return;
        if (MasterFormats.isAdmitted(name)) {
            submit(name.replaceAll("\\.[^.]+$", ""), inbox.resolve(name));
        }
    }

    private void submit(String id, Path file) {
        if (!seen.add(file.toAbsolutePath().normalize())) return;
        onMaster.accept(id, file);
    }

    void done(Path file) {
        seen.remove(file.toAbsolutePath().normalize());
    }
}
