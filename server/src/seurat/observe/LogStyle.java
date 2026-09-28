package seurat.observe;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * ANSI colours for a terminal log line: grey time, coloured level, magenta tag; in the message the
 * subject stands out, k=v keys are dimmed, protocol names (LATIDO, PINTANDO, ERR_...) are bold, and
 * WARN/ERROR tint the whole message. Only intensity and foreground resets are used inside the
 * message, so the tint survives every highlight.
 */
final class LogStyle {
    private static final String ESC = "\u001B[";
    private static final String RESET = ESC + "0m";
    private static final String GREY = ESC + "90m";
    private static final String MAGENTA = ESC + "35m";
    private static final String SUBJECT = ESC + "94m";
    private static final String DEFAULT_FG = ESC + "39m";
    private static final String BOLD = ESC + "1m";
    private static final String DIM = ESC + "2m";
    private static final String NORMAL = ESC + "22m";
    /** The subject convention: s7, s7/c3, or a leading k=v (work=venus, remote=/1.2.3.4:5678, zip=...). */
    private static final Pattern SUBJECT_TOKEN = Pattern.compile("^(s\\d+(/c\\d+)?|[a-z]+=\\S+)(?=\\s|$)");
    private static final Pattern KEY = Pattern.compile("(?<=\\s)[a-z][a-z0-9_]*(?==)");
    /** A whole upper-case word or value: frame, state and error names, never part of a file name. */
    private static final Pattern PROTO = Pattern.compile("(?<=^|[\\s=])[A-Z][A-Z0-9_]{2,}(?=$|[\\s:,])");

    private LogStyle() {}

    static String line(LogLevel level, String ts, String paddedLevel, String paddedTag, String msg) {
        return GREY + ts + RESET + " " + levelColor(level) + paddedLevel + RESET + " "
                + MAGENTA + "[" + paddedTag + "]" + RESET + " " + message(level, msg) + RESET;
    }

    static String message(LogLevel level, String msg) {
        String tint = tint(level);
        String head = "";
        String rest = msg;
        Matcher subject = SUBJECT_TOKEN.matcher(msg);
        if (subject.find()) {
            head = tint.isEmpty() ? SUBJECT + subject.group() + DEFAULT_FG : BOLD + subject.group() + NORMAL;
            rest = msg.substring(subject.end());
        }
        rest = PROTO.matcher(rest).replaceAll(BOLD + "$0" + NORMAL);
        rest = KEY.matcher(rest).replaceAll(DIM + "$0" + NORMAL);
        return tint + head + rest;
    }

    private static String tint(LogLevel level) {
        return switch (level) {
            case WARN -> ESC + "33m";
            case ERROR -> ESC + "31m";
            default -> "";
        };
    }

    private static String levelColor(LogLevel level) {
        return switch (level) {
            case DEBUG -> ESC + "36m";
            case INFO -> ESC + "32m";
            case WARN -> ESC + "33m";
            case ERROR -> ESC + "31;1m";
            default -> RESET;
        };
    }
}
