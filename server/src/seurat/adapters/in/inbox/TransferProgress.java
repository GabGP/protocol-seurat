package seurat.adapters.in.inbox;

import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.shared.observe.Progress;

/**
 * One transfer into staging, as the console sees it: a start line, the shared progress bar (a
 * line per step when stdout is not a terminal), then an end line with took and rate, or a warning.
 * Without a known size the bar is open-ended and shows the bytes so far.
 */
final class TransferProgress {
    private final String key;
    private final String phase;
    private final long total;
    private final long start = System.currentTimeMillis();
    private long written;
    private long shown;

    /** phase is the running verb ("receiving", "downloading"); total is -1 when unknown. */
    TransferProgress(String name, String phase, long total, String from) {
        this.key = LogTags.work(name);
        this.phase = phase;
        this.total = total;
        Log.info(LogTags.INGEST, key + " " + phase + " size=" + (total > 0 ? LogUnits.bytes(total) : "unknown")
                + (from == null ? "" : " from=" + from));
    }

    void add(int bytes) {
        written += bytes;
        long now = System.currentTimeMillis();
        String rate = " rate=" + LogUnits.rate(written, now - start);
        if (total > 0) {
            Progress.update(LogTags.INGEST, key, phase, (int) (written * Units.PERCENT / total), rate);
        } else if (now - shown >= IntakeConstants.TRANSFER_TICK_MS) {
            shown = now;
            Progress.phase(LogTags.INGEST, key, phase, " so_far=" + LogUnits.bytes(written) + rate);
        }
    }

    /** done is the finished verb ("received", "downloaded"). */
    void finish(String done) {
        Progress.done(key);
        long took = System.currentTimeMillis() - start;
        Log.info(LogTags.INGEST, key + " " + done + " size=" + LogUnits.bytes(written)
                + " took=" + LogUnits.duration(took) + " rate=" + LogUnits.rate(written, took));
    }

    void fail(Throwable cause) {
        Progress.done(key);
        Log.warn(LogTags.INGEST, key + " " + phase + " failed after " + LogUnits.bytes(written)
                + ": " + LogUnits.cause(cause));
    }
}
