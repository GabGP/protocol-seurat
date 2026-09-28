package seurat.observe;

import java.time.Duration;
import java.util.Locale;

/** The one place log lines turn sizes, durations, rates and causes into text (binary units, "Xm Ys Zms"). */
public final class LogUnits {
    private static final long KIB = 1024;
    private static final long MIB = KIB * KIB;
    private static final long GIB = MIB * KIB;
    private static final double MEGAPIXEL = 1_000_000.0;

    private LogUnits() {}

    public static String bytes(long bytes) {
        if (bytes < KIB) return bytes + " B";
        if (bytes < MIB) return String.format(Locale.US, "%.1f KiB", bytes / (double) KIB);
        if (bytes < GIB) return String.format(Locale.US, "%.1f MiB", bytes / (double) MIB);
        return String.format(Locale.US, "%.2f GiB", bytes / (double) GIB);
    }

    public static String duration(long millis) {
        Duration d = Duration.ofMillis(Math.max(0, millis));
        return d.toMinutes() + "m " + d.toSecondsPart() + "s " + d.toMillisPart() + "ms";
    }

    /** Throughput in MiB/s; a zero-length interval counts as 1 ms. */
    public static String rate(long bytes, long millis) {
        double seconds = Math.max(1, millis) / 1000.0;
        return String.format(Locale.US, "%.1f MiB/s", bytes / (double) MIB / seconds);
    }

    /** Decode throughput in megapixels per second; a zero-length interval counts as 1 ms. */
    public static String pixelRate(long pixels, long millis) {
        double seconds = Math.max(1, millis) / 1000.0;
        return String.format(Locale.US, "%.1f Mpx/s", pixels / MEGAPIXEL / seconds);
    }

    /** The ": cause" tail: the exception message, or its class when it has none (NPE, some Errors). */
    public static String cause(Throwable ex) {
        String msg = ex.getMessage();
        return msg != null && !msg.isBlank() ? msg : ex.getClass().getSimpleName();
    }
}
