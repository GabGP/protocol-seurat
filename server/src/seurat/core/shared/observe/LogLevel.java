package seurat.core.shared.observe;

/** Severity levels for console and audit logging. */
public enum LogLevel {
    DEBUG(1),
    INFO(2),
    WARN(3),
    ERROR(4),
    NONE(5);

    public final int severity;

    LogLevel(int severity) {
        this.severity = severity;
    }

    public static LogLevel fromString(String str, LogLevel fallback) {
        if (str == null || str.isBlank()) {
            return fallback;
        }
        try {
            return LogLevel.valueOf(str.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            return fallback;
        }
    }
}
