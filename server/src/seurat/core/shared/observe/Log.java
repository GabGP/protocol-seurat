package seurat.core.shared.observe;

import java.io.PrintStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** Structured console logger with levels, timestamps, tags, and colors (LogStyle, on stdout only). */
public final class Log {
    public static final int LEVEL_WIDTH = 5;
    public static final int TAG_WIDTH = 10;

    private static volatile LogLevel currentLevel = LogLevel.INFO;
    private static volatile PrintStream target = System.out;
    /** Colours go to the process's own stdout only: a captured stream (tests, audit) stays plain. */
    private static volatile boolean styled = true;
    private static final Object PRINT_LOCK = new Object();
    /** The sticky progress line is on screen (no newline after it yet); guarded by PRINT_LOCK. */
    private static boolean barShown;
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");
    /**
     * stdout is a terminal. run.sh / run.ps1 test it and pass -Dseurat.log.tty (mintty has no Java
     * console; TERM stays set when output is redirected); a bare java launch falls back to the console.
     */
    static final boolean TTY = Boolean.parseBoolean(
            System.getProperty("seurat.log.tty", String.valueOf(System.console() != null)));
    private static final boolean COLOR = TTY
            && System.getenv("NO_COLOR") == null
            && !"false".equalsIgnoreCase(System.getProperty("seurat.log.color"));

    private Log() {}

    public static void setLevel(LogLevel level) {
        if (level != null) {
            currentLevel = level;
        }
    }

    public static LogLevel getLevel() {
        return currentLevel;
    }

    public static void setOutput(PrintStream out) {
        synchronized (PRINT_LOCK) {
            target = out != null ? out : System.out;
            styled = target == System.out;
            barShown = false;
        }
    }

    public static boolean isDebugEnabled() {
        return currentLevel.severity <= LogLevel.DEBUG.severity;
    }

    public static boolean isInfoEnabled() {
        return currentLevel.severity <= LogLevel.INFO.severity;
    }

    public static void debug(String tag, String msg) {
        log(LogLevel.DEBUG, tag, msg, null);
    }

    public static void info(String tag, String msg) {
        log(LogLevel.INFO, tag, msg, null);
    }

    public static void warn(String tag, String msg) {
        log(LogLevel.WARN, tag, msg, null);
    }

    public static void warn(String tag, String msg, Throwable t) {
        log(LogLevel.WARN, tag, msg, t);
    }

    public static void error(String tag, String msg) {
        log(LogLevel.ERROR, tag, msg, null);
    }

    public static void error(String tag, String msg, Throwable t) {
        log(LogLevel.ERROR, tag, msg, t);
    }

    private static void log(LogLevel level, String tag, String msg, Throwable t) {
        if (level.severity < currentLevel.severity) {
            return;
        }
        msg = LogNames.fit(msg);
        String ts = LocalDateTime.now().format(FMT);
        String paddedLevel = padRight(level.name(), LEVEL_WIDTH);
        String paddedTag = padRight(tag != null ? tag : "", TAG_WIDTH);
        String line = COLOR && styled
                ? LogStyle.line(level, ts, paddedLevel, paddedTag, msg)
                : ts + " " + paddedLevel + " [" + paddedTag + "] " + msg;
        synchronized (PRINT_LOCK) {
            PrintStream out = target;
            if (barShown) {
                out.print(ProgressRender.wipe());
            }
            out.println(line);
            if (t != null) {
                t.printStackTrace(out);
            }
            drawBar(out);
        }
    }

    /** Progress changed: repaint the sticky line in place (wiped when no job is left). */
    static void redraw() {
        synchronized (PRINT_LOCK) {
            PrintStream out = target;
            if (barShown) {
                out.print(ProgressRender.wipe());
            }
            drawBar(out);
        }
    }

    private static void drawBar(PrintStream out) {
        String bar = Progress.line();
        out.print(bar);
        barShown = !bar.isEmpty();
        out.flush();
    }

    private static String padRight(String s, int width) {
        int pad = width - s.length();
        return pad > 0 ? s + " ".repeat(pad) : s;
    }
}
