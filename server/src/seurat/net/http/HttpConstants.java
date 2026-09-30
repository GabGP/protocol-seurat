package seurat.net.http;

/** Content types and JSON bodies the HTTP surface answers with. */
public final class HttpConstants {
    public static final String JSON = "application/json";
    public static final String HTML = "text/html; charset=utf-8";
    public static final String JAVASCRIPT = "text/javascript; charset=utf-8";
    public static final String CSS = "text/css; charset=utf-8";
    public static final String BINARY = "application/octet-stream";
    public static final String NOT_FOUND_BODY = "{\"error\":\"no existe\"}";
    public static final String INTERNAL_BODY = "{\"error\":\"interno\"}";
    /** HTTP/1.1 line terminator (RFC 9112). */
    public static final String CRLF = "\r\n";
    /** Every response is no-store unless it names its own Cache-Control; static files revalidate by ETag. */
    public static final String CACHE_CONTROL = "Cache-Control";
    public static final String NO_CACHE = "no-cache";
    public static final String ETAG = "ETag";
    public static final String IF_NONE_MATCH = "if-none-match";
    /** Cross-origin isolation (Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy): lets the page measure its own memory. */
    public static final String COOP = "Cross-Origin-Opener-Policy";
    public static final String COOP_VALUE = "same-origin";
    public static final String COEP = "Cross-Origin-Embedder-Policy";
    /** Everything the viewer loads is same-origin (no CDN), so require-corp blocks nothing. */
    public static final String COEP_VALUE = "require-corp";
    public static final int OK = 200;
    public static final int CREATED = 201;
    public static final int NOT_MODIFIED = 304;
    public static final int NOT_FOUND = 404;
    public static final int INTERNAL = 500;

    private HttpConstants() {}
}
