package seurat.server;

import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipFile;
import seurat.ingest.MasterFormats;
import seurat.observe.Log;
import seurat.observe.LogUnits;

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

    static boolean waitForReady(Path file, long pollMs, long emptyTimeoutMs, long stallTimeoutMs) {
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
                    Log.warn("ingest", "file=" + file.getFileName() + " skipped: still empty");
                    return false;
                }
                if (!pause(pollMs)) return false;
                continue;
            }
            if (size != lastSize) {
                lastSize = size;
                lastGrowth = now;
                if (now - lastLog >= LOG_INTERVAL_MS) {
                    Log.info("ingest", "file=" + file.getFileName() + " waiting written=" + LogUnits.bytes(size));
                    lastLog = now;
                }
            } else if (isComplete(file, size)) {
                Log.info("ingest", "file=" + file.getFileName() + " ready size=" + LogUnits.bytes(size));
                return true;
            } else if (now - lastGrowth >= stallTimeoutMs) {
                Log.warn("ingest", "file=" + file.getFileName() + " skipped: transfer stalled incomplete");
                return false;
            }
            if (!pause(pollMs)) return false;
        }
    }

    static boolean isComplete(Path file, long size) {
        String lower = file.getFileName().toString().toLowerCase();
        if (lower.endsWith(".zip")) return isZipComplete(file, size);
        if (lower.endsWith(".png")) return isPngComplete(file, size);
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return isJpgComplete(file, size);
        return MasterFormats.isWhole(file, size);
    }

    private static boolean isZipComplete(Path file, long size) {
        if (size < 22) return false;
        try (var zf = new ZipFile(file.toFile())) {
            return zf.size() >= 0;
        } catch (Exception ex) {
            return false;
        }
    }

    private static boolean isPngComplete(Path file, long size) {
        if (size < 12) return false;
        try (var ch = FileChannel.open(file, StandardOpenOption.READ)) {
            ByteBuffer buf = ByteBuffer.allocate(12);
            ch.position(size - 12);
            ch.read(buf);
            buf.flip();
            return buf.getInt() == 0 && buf.getInt() == 0x49454E44 && buf.getInt() == 0xAE426082;
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
