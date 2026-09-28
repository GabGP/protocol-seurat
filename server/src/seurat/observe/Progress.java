package seurat.observe;

import java.util.Map;
import java.util.StringJoiner;
import java.util.concurrent.ConcurrentSkipListMap;
import seurat.config.SeuratConstants;
import seurat.config.Units;

/**
 * Long jobs (inbox copy, unzip, ingest), each in a named phase ("unzipping", "painting"...). On a
 * terminal they share one sticky line that Log wipes and redraws around every log line; otherwise
 * each crossed PROGRESS_STEP_PCT of a phase is one INFO line and every other change a DEBUG line,
 * so a captured log never holds carriage returns. A phase without a total shows as [~].
 */
public final class Progress {
    private static final int UNKNOWN = -1;
    private static final String QUEUED = "queued";
    private static final Map<String, Job> JOBS = new ConcurrentSkipListMap<>();
    private static volatile boolean live = Log.TTY
            && !"false".equalsIgnoreCase(System.getProperty("seurat.log.progress"));

    /** pct is UNKNOWN while the phase has no total; since is when the phase began (ETA base). */
    private record Job(String phase, int pct, String suffix, long since) {
        String text(String key, String label) {
            if (pct == UNKNOWN) {
                return key + " " + phase + " " + label + "[~]" + suffix;
            }
            return key + " " + phase + " " + label + ProgressRender.bar(pct) + " " + pct + "%" + suffix
                    + ProgressRender.eta(pct, System.currentTimeMillis() - since);
        }
    }

    private Progress() {}

    /** Tests pin the mode; the default follows whether stdout is a terminal (Log.TTY). */
    static void setLive(boolean on) {
        live = on;
    }

    /** key is the line's subject ("work=venus"); suffix trails the percent (" rate=85.2 MiB/s" or ""). */
    public static void update(String tag, String key, String phase, int pct, String suffix) {
        track(tag, key, phase, Math.max(0, Math.min(Units.PERCENT, pct)), suffix);
    }

    /** A phase with no total yet ("waiting", "sketching"): an open-ended [~] segment. */
    public static void phase(String tag, String key, String phase, String suffix) {
        track(tag, key, phase, UNKNOWN, suffix);
    }

    /** Waiting for the ingest thread: the sticky line counts these in one "queued=N" segment. */
    public static void queue(String tag, String key) {
        phase(tag, key, QUEUED, "");
    }

    private static void track(String tag, String key, String phase, int pct, String suffix) {
        Job before = JOBS.get(key);
        boolean same = before != null && before.phase.equals(phase);
        Job job = new Job(phase, pct, suffix, same ? before.since : System.currentTimeMillis());
        JOBS.put(key, job);
        if (same && before.pct == pct && (pct != UNKNOWN || before.suffix.equals(suffix))) {
            return;
        }
        if (live()) {
            Log.redraw();
            return;
        }
        int step = SeuratConstants.PROGRESS_STEP_PCT;
        if (pct != UNKNOWN && pct / step > (same ? Math.max(0, before.pct) / step : 0)) {
            Log.info(tag, job.text(key, "progress="));
        } else if (Log.isDebugEnabled()) {
            Log.debug(tag, job.text(key, "progress="));
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

    /** The sticky line, running jobs then "queued=N", cut to the terminal width; empty when nothing runs. */
    static String line() {
        if (!live() || JOBS.isEmpty()) {
            return "";
        }
        StringJoiner all = new StringJoiner(" | ");
        int queued = 0;
        for (Map.Entry<String, Job> e : JOBS.entrySet()) {
            if (e.getValue().phase.equals(QUEUED)) {
                queued++;
            } else {
                all.add(e.getValue().text(e.getKey(), ""));
            }
        }
        if (queued > 0) {
            all.add(QUEUED + "=" + queued);
        }
        String text = LogNames.cut(all.toString());
        int cols = ProgressRender.columns() - 1;
        return text.length() > cols ? text.substring(0, cols) : text;
    }

    private static boolean live() {
        return live && Log.isInfoEnabled();
    }
}
