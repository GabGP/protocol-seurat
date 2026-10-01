package seurat.adapters.in.net.http;

/** Content types and JSON bodies the HTTP surface answers with. */
public final class HttpConstants {
    public static final String JSON = "application/json";
    public static final String HTML = "text/html; charset=utf-8";
    public static final String JAVASCRIPT = "text/javascript; charset=utf-8";
    public static final String CSS = "text/css; charset=utf-8";
    public static final String SVG = "image/svg+xml";
    public static final String TEXT = "text/plain; charset=utf-8";
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
    /** Content negotiation (RFC 9110 §12.5.3, §8.4, §12.5.5): static text goes out gzip-encoded when accepted. */
    public static final String ACCEPT_ENCODING = "Accept-Encoding";
    public static final String CONTENT_ENCODING = "Content-Encoding";
    public static final String VARY = "Vary";
    public static final String GZIP = "gzip";
    /** The gzip representation's strong ETag is the identity one with this suffix inside the quotes. */
    public static final String GZIP_ETAG_SUFFIX = "-gz";
    /** Below this a body fits one segment anyway: gzip saves no round trip, so it goes out as is. */
    public static final int GZIP_MIN_BYTES = 1024;
    /** Cross-origin isolation (Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy): lets the page measure its own memory. */
    public static final String COOP = "Cross-Origin-Opener-Policy";
    public static final String COOP_VALUE = "same-origin";
    public static final String COEP = "Cross-Origin-Embedder-Policy";
    /** Everything the viewer loads is same-origin (no CDN), so require-corp blocks nothing. */
    public static final String COEP_VALUE = "require-corp";
    /** How long a finished connection waits for the browser to close first before the server closes it. */
    public static final int CLOSE_LINGER_MS = 2_000;
    /** Read chunk used to drain a closing connection. */
    public static final int CLOSE_DRAIN_BYTES = 1024;
    public static final int OK = 200;
    public static final int CREATED = 201;
    public static final int NOT_MODIFIED = 304;
    public static final int NOT_FOUND = 404;
    public static final int INTERNAL = 500;

    private HttpConstants() {}
}
