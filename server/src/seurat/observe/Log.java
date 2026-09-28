package seurat.observe;

import java.io.PrintStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/** Structured console logger with levels, timestamps, tags, and colors. */
public final class Log {
    public static final int LEVEL_WIDTH = 5;
    public static final int TAG_WIDTH = 10;

    private static volatile LogLevel currentLevel = LogLevel.INFO;
    private static volatile PrintStream target = System.out;
    private static final Object PRINT_LOCK = new Object();
    /** The sticky progress line is on screen (no newline after it yet); guarded by PRINT_LOCK. */
    private static boolean barShown;
    private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");
    private static final boolean COLOR = (System.console() != null
            || (System.getenv("TERM") != null && !"dumb".equals(System.getenv("TERM"))))
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
        String ts = LocalDateTime.now().format(FMT);
        String paddedLevel = padRight(level.name(), LEVEL_WIDTH);
        String paddedTag = padRight(tag != null ? tag : "", TAG_WIDTH);
        StringBuilder sb = new StringBuilder(128);
        if (COLOR) {
            sb.append("\u001B[90m").append(ts).append("\u001B[0m ")
              .append(colorFor(level)).append(paddedLevel).append("\u001B[0m ")
              .append("\u001B[35m[").append(paddedTag).append("]\u001B[0m ")
              .append(msg);
        } else {
            sb.append(ts).append(" ")
              .append(paddedLevel).append(" ")
              .append("[").append(paddedTag).append("] ")
              .append(msg);
        }
        synchronized (PRINT_LOCK) {
            PrintStream out = target;
            if (barShown) {
                out.print(Progress.wipe());
            }
            out.println(sb);
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
                out.print(Progress.wipe());
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

    private static String colorFor(LogLevel level) {
        return switch (level) {
            case DEBUG -> "\u001B[36m";
            case INFO  -> "\u001B[32m";
            case WARN  -> "\u001B[33m";
            case ERROR -> "\u001B[31;1m";
            default    -> "\u001B[0m";
        };
    }
}
