package seurat.config;

/** Unit conversions: time, size and percent. The one place these literals live. */
public final class Units {
    private Units() {}

    public static final long NANOS_PER_S = 1_000_000_000L;
    public static final long NANOS_PER_MS = 1_000_000L;
    public static final long MS_PER_S = 1000L;
    public static final int BYTES_PER_KIB = 1024;
    public static final int BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;
    public static final int PERCENT = 100;
}
