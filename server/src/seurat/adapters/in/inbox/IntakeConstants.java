package seurat.adapters.in.inbox;

/** Constants for intake, staging and upload operations. */
public final class IntakeConstants {
    /** Suffix for temporary files written in staging before atomic publish. */
    public static final String PART_SUFFIX = ".part";

    /** Stream copy buffer size (64 KiB), keeping at most one buffer in memory. */
    public static final int COPY_BUFFER = 1 << 16;

    /** Connect timeout in seconds for upstream downloads. */
    public static final int DOWNLOAD_CONNECT_TIMEOUT_S = 10;

    /** Minimum byte length required for an upload. */
    public static final long MIN_UPLOAD_BYTES = 1L;

    /** Format string for the 8-character random hex token in part file names. */
    public static final String HEX_FORMAT = "%08x";

    private IntakeConstants() {}
}
