package seurat.observe;

/** The tag column of a log line, and the work= key every ingest and catalog line shares. */
public final class LogTags {
    public static final String ADMIN = "admin";
    public static final String AUDIT = "audit";
    public static final String BUDGET = "budget";
    public static final String CATALOG = "catalog";
    public static final String CONCESSION = "concession";
    public static final String HTTP = "http";
    public static final String INGEST = "ingest";
    public static final String LIVENESS = "liveness";
    public static final String NET = "net";
    public static final String PAINT = "paint";
    public static final String PROTO = "proto";
    public static final String REAPER = "reaper";
    public static final String SERVER = "server";
    public static final String SESSION = "session";
    public static final String WS = "ws";

    private LogTags() {}

    /** "work=<id>", the key LogNames aligns. */
    public static String work(String id) {
        return "work=" + id;
    }
}
