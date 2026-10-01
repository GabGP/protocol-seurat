package seurat.adapters.in.inbox;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.BiPredicate;
import java.util.zip.ZipFile;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.observe.Progress;

/** Waits for an inbox file transfer to complete and verifies file integrity. */
final class FileTransferWaiter {
    static final long POLL_MS = 500;
    static final long EMPTY_TIMEOUT_MS = 10_000;
    static final long STALL_TIMEOUT_MS = 15_000;
    static final long LOG_INTERVAL_MS = 5_000;

    private FileTransferWaiter() {}

    static boolean waitForReady(Path file, BiPredicate<Path, Long> whole) {
        return waitForReady(file, whole, POLL_MS, EMPTY_TIMEOUT_MS, STALL_TIMEOUT_MS);
    }

    /** While it polls, the file is a "waiting" segment on the progress bar (no total: the copy may still grow). */
    static boolean waitForReady(Path file, BiPredicate<Path, Long> whole, long pollMs, long emptyTimeoutMs,
            long stallTimeoutMs) {
        String key = "file=" + file.getFileName();
        try {
            return poll(file, key, whole, pollMs, emptyTimeoutMs, stallTimeoutMs);
        } finally {
            Progress.done(key);
        }
    }

    private static boolean poll(Path file, String key, BiPredicate<Path, Long> whole, long pollMs,
            long emptyTimeoutMs, long stallTimeoutMs) {
        if (!Files.exists(file)) return false;
        long lastSize = -1;
        long lastGrowth = System.currentTimeMillis();
        long lastLog = 0;
        for (;;) {
            if (!Files.exists(file)) return false;
            long size;
            try {
                size = Files.size(file);
            } catch (Exception ex) {
                size = -1;
            }
            long now = System.currentTimeMillis();
            if (size <= 0) {
                if (now - lastGrowth >= emptyTimeoutMs) {
                    Log.warn(LogTags.INGEST, key + " skipped: still empty");
                    return false;
                }
                if (!pause(pollMs)) return false;
                continue;
            }
            if (size != lastSize) {
                lastSize = size;
                lastGrowth = now;
                Progress.phase(LogTags.INGEST, key, "waiting", " written=" + LogUnits.bytes(size));
                if (now - lastLog >= LOG_INTERVAL_MS) {
                    Log.info(LogTags.INGEST, key + " waiting written=" + LogUnits.bytes(size));
                    lastLog = now;
                }
            } else if (isComplete(file, size, whole)) {
                Log.info(LogTags.INGEST, key + " ready size=" + LogUnits.bytes(size));
                return true;
            } else if (now - lastGrowth >= stallTimeoutMs) {
                Log.warn(LogTags.INGEST, key + " skipped: transfer stalled incomplete");
                return false;
            }
            if (!pause(pollMs)) return false;
        }
    }

    /** A zip is checked here; any other master by the decoders' own rule ({@code whole}). */
    static boolean isComplete(Path file, long size, BiPredicate<Path, Long> whole) {
        if (ZipNames.isZip(file.getFileName().toString())) return isZipComplete(file, size);
        return whole.test(file, size);
    }

    private static boolean isZipComplete(Path file, long size) {
        if (size < ZipNames.EOCD_BYTES) return false;
        try (var zf = new ZipFile(file.toFile())) {
            return zf.size() >= 0;
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean pause(long ms) {
        try {
            Thread.sleep(ms);
            return true;
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}
