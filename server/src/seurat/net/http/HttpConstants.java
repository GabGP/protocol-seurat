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
    public static final int OK = 200;
    public static final int CREATED = 201;
    public static final int NOT_FOUND = 404;
    public static final int INTERNAL = 500;

    private HttpConstants() {}
}
