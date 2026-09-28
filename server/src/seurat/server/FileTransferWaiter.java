package seurat.server;

import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipFile;
import seurat.ingest.FormatMarkers;
import seurat.ingest.MasterFormats;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.observe.Progress;

/** Waits for an inbox file transfer to complete and verifies file integrity. */
final class FileTransferWaiter {
    static final long POLL_MS = 500;
    static final long EMPTY_TIMEOUT_MS = 10_000;
    static final long STALL_TIMEOUT_MS = 15_000;
    static final long LOG_INTERVAL_MS = 5_000;

    private FileTransferWaiter() {}

    static boolean waitForReady(Path file) {
        return waitForReady(file, POLL_MS, EMPTY_TIMEOUT_MS, STALL_TIMEOUT_MS);
    }

    /** While it polls, the file is a "waiting" segment on the progress bar (no total: the copy may still grow). */
    static boolean waitForReady(Path file, long pollMs, long emptyTimeoutMs, long stallTimeoutMs) {
        String key = "file=" + file.getFileName();
        try {
            return poll(file, key, pollMs, emptyTimeoutMs, stallTimeoutMs);
        } finally {
            Progress.done(key);
        }
    }

    private static boolean poll(Path file, String key, long pollMs, long emptyTimeoutMs, long stallTimeoutMs) {
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
            } else if (isComplete(file, size)) {
                Log.info(LogTags.INGEST, key + " ready size=" + LogUnits.bytes(size));
                return true;
            } else if (now - lastGrowth >= stallTimeoutMs) {
                Log.warn(LogTags.INGEST, key + " skipped: transfer stalled incomplete");
                return false;
            }
            if (!pause(pollMs)) return false;
        }
    }

    static boolean isComplete(Path file, long size) {
        String lower = file.getFileName().toString().toLowerCase();
        if (lower.endsWith(FormatMarkers.ZIP_EXTENSION)) return isZipComplete(file, size);
        if (lower.endsWith(".png")) return isPngComplete(file, size);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return isJpgComplete(file, size);
        return MasterFormats.isWhole(file, size);
    }

    private static boolean isZipComplete(Path file, long size) {
        if (size < FormatMarkers.ZIP_EOCD_BYTES) return false;
        try (var zf = new ZipFile(file.toFile())) {
            return zf.size() >= 0;
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean isPngComplete(Path file, long size) {
        if (size < FormatMarkers.PNG_TAIL_BYTES) return false;
        try (var ch = FileChannel.open(file, StandardOpenOption.READ)) {
            ByteBuffer buf = ByteBuffer.allocate(FormatMarkers.PNG_TAIL_BYTES);
            ch.position(size - FormatMarkers.PNG_TAIL_BYTES);
            ch.read(buf);
            buf.flip();
            return buf.getInt() == 0 && buf.getInt() == FormatMarkers.PNG_IEND && buf.getInt() == FormatMarkers.PNG_IEND_CRC;
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean isJpgComplete(Path file, long size) {
        if (size < 2) return false;
        try (var ch = FileChannel.open(file, StandardOpenOption.READ)) {
            ByteBuffer buf = ByteBuffer.allocate(2);
            ch.position(size - 2);
            ch.read(buf);
            buf.flip();
            return (buf.get() & 0xFF) == 0xFF && (buf.get() & 0xFF) == 0xD9;
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
