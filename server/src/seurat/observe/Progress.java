package seurat.observe;

import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentSkipListMap;
import seurat.config.SeuratConstants;

/**
 * Long jobs with a known total (ingest painting, zip extraction). On a terminal they share one sticky
 * line that Log wipes and redraws around every log line; otherwise each crossed PROGRESS_STEP_PCT is
 * one INFO line and every other percent a DEBUG line, so a captured log never holds carriage returns.
 */
public final class Progress {
    private static final Map<String, Job> JOBS = new ConcurrentSkipListMap<>();
    private static volatile boolean live = System.console() != null
            && !"false".equalsIgnoreCase(System.getProperty("seurat.log.progress"));

    private record Job(int pct, String suffix) {}

    private Progress() {}

    /** Tests pin the mode; the default follows whether stdout is a console. */
    static void setLive(boolean on) {
        live = on;
    }

    /** key is the line's subject ("work=venus"); suffix trails the percent (" rate=85.2 MiB/s" or ""). */
    public static void update(String tag, String key, int pct, String suffix) {
        int p = Math.max(0, Math.min(100, pct));
        Job before = JOBS.put(key, new Job(p, suffix));
        if (before != null && before.pct == p) {
            return;
        }
        if (live()) {
            Log.redraw();
            return;
        }
        int step = SeuratConstants.PROGRESS_STEP_PCT;
        if (p / step > (before == null ? 0 : before.pct / step)) {
            Log.info(tag, key + " progress=" + bar(p) + " " + p + "%" + suffix);
        } else if (Log.isDebugEnabled()) {
            Log.debug(tag, key + " progress=" + bar(p) + " " + p + "%" + suffix);
        }
    }

    public static void done(String key) {
        if (JOBS.remove(key) != null && live()) {
            Log.redraw();
        }
    }

    /** Drops every job (shutdown), so the last thing on the terminal is a log line, not a bar. */
    public static void clear() {
        JOBS.clear();
        if (live()) {
            Log.redraw();
        }
    }

    /** The sticky line, cut to the terminal width; empty when nothing runs or output is not a console. */
    static String line() {
        if (!live() || JOBS.isEmpty()) {
            return "";
        }
        StringJoiner all = new StringJoiner(" | ");
        JOBS.forEach((key, job) -> all.add(key + " " + bar(job.pct) + " " + job.pct + "%" + job.suffix));
        String text = all.toString();
        int cols = columns() - 1;
        return text.length() > cols ? text.substring(0, cols) : text;
    }

    /** Carriage return, blanks over the widest line() can be, carriage return: no escape codes needed. */
    static String wipe() {
        return "\r" + " ".repeat(columns() - 1) + "\r";
    }

    static String bar(int pct) {
        int cells = SeuratConstants.PROGRESS_BAR_CELLS;
        int full = pct * cells / 100;
        return "[" + "#".repeat(full) + "-".repeat(cells - full) + "]";
    }

    private static boolean live() {
        return live && Log.isInfoEnabled();
    }

    private static int columns() {
        try {
            return Math.max(2, Integer.parseInt(System.getenv("COLUMNS")));
        } catch (NumberFormatException ex) {
            return SeuratConstants.PROGRESS_COLUMNS;
        }
    }
}
