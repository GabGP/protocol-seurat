package seurat.adapters.in.inbox;

/** Constants for intake, staging and upload operations. */
public final class IntakeConstants {
    /** Suffix for temporary files written in staging before atomic publish. */
    public static final String PART_SUFFIX = ".part";

    /** Stream copy buffer size (64 KiB), keeping at most one buffer in memory. */
    public static final int COPY_BUFFER = 1 << 16;

    /** Connect timeout in seconds for upstream downloads. */
    public static final int DOWNLOAD_CONNECT_TIMEOUT_S = 10;

    /** How often a transfer of unknown size refreshes its progress line. */
    public static final long TRANSFER_TICK_MS = 1_000;

    /** Minimum byte length required for an upload. */
    public static final long MIN_UPLOAD_BYTES = 1L;

    /** Format string for the 8-character random hex token in part file names. */
    public static final String HEX_FORMAT = "%08x";

    /** Character count for surrounding quotes pair. */
    public static final int SURROUNDING_QUOTES = 2;

    /** Minimum inclusive HTTP success status code (200 OK). */
    public static final int HTTP_OK = 200;

    /** Maximum exclusive HTTP success status code (300 Multiple Choices). */
    public static final int HTTP_MULTIPLE_CHOICES = 300;

    /** Fallback file name stem when remote URL path segment is empty. */
    public static final String DEFAULT_DOWNLOAD_STEM = "download";

    /** Key for filename attribute in Content-Disposition header. */
    public static final String CONTENT_DISPOSITION_FILENAME = "filename";

    /** URL scheme for HTTP. */
    public static final String SCHEME_HTTP = "http";

    /** URL scheme for HTTPS. */
    public static final String SCHEME_HTTPS = "https";

    private IntakeConstants() {}
}
