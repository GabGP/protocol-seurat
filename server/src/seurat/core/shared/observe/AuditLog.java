package seurat.core.shared.observe;

import java.time.Instant;
import java.util.concurrent.ConcurrentLinkedQueue;
import seurat.core.shared.config.SeuratConstants;

/** Operator alerts: CRC failures, budget hits, audit mismatches. Each one is logged once and kept for dump(). */
public final class AuditLog {
    private static final ConcurrentLinkedQueue<String> QUEUE = new ConcurrentLinkedQueue<>();

    private AuditLog() {}

    public static void alert(String msg) {
        keep("ALERT", msg);
        Log.warn(LogTags.AUDIT, msg);
    }

    /** A failure with a cause: one ERROR line with the stack, never a second copy elsewhere. */
    public static void alert(String msg, Throwable cause) {
        keep("ALERT", msg);
        Log.error(LogTags.AUDIT, msg, cause);
    }

    public static void info(String msg) {
        keep("INFO", msg);
        Log.info(LogTags.AUDIT, msg);
    }

    public static String[] dump() {
        return QUEUE.toArray(new String[0]);
    }

    /** Bounded: a corrupt band alerts on every read, so only the last AUDIT_KEEP entries stay. */
    private static void keep(String level, String msg) {
        QUEUE.add(Instant.now() + " " + level + " " + msg);
        while (QUEUE.size() > SeuratConstants.AUDIT_KEEP) {
            QUEUE.poll();
        }
    }
}
