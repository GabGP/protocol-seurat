package seurat.net.http;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import seurat.catalog.Catalog;
import seurat.config.SeuratConfig;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.session.Sessions;

/**
 * HTTP routes (spec 3.1). Only handshake and intake live here; points never do:
 * the single egress stays paint/Painter over PINCELADA flows.
 */
public final class HttpSurface {
    /** body is read up front, except a master upload, which streams (length bytes from stream). */
    public record Request(String method, String path, Map<String, String> headers,
            byte[] body, String host, InputStream stream, long length) {
        public Request(String method, String path, Map<String, String> headers, byte[] body, String host) {
            this(method, path, headers, body, host, null, body.length);
        }
    }

    public record Response(int code, String type, byte[] body, Map<String, String> headers) {
        public Response(int code, String type, byte[] body) {
            this(code, type, body, Map.of());
        }
    }

    private final StaticRoute statics;
    private final SessionRoute session;
    private final WorkRoutes routes;

    public HttpSurface(Path staticRoot, Sessions sessions, Catalog catalog,
            SeuratConfig config, BiConsumer<String, Path> onMaster,
            Consumer<String> onPolicy, Consumer<String> onWithdraw) {
        this.statics = new StaticRoute(staticRoot);
        this.session = new SessionRoute(sessions, config);
        this.routes = new WorkRoutes(catalog, config, onMaster, onPolicy, onWithdraw);
    }

    /** PUT /seurat/v1/obras/{id} streams to inbox/ instead of being buffered in memory. */
    public static boolean streamed(String method, String path) {
        return method.equals("PUT") && WorkRoutes.isMasterUpload(path);
    }

    public Response route(Request req) {
        try {
            if (req.method().equals("GET") || req.method().equals("HEAD")) {
                return statics.get(req);
            }
            if (req.method().equals("POST") && req.path().equals("/seurat/v1/sesion")) {
                return session.issue(req);
            }
            if (req.path().startsWith("/seurat/v1/obras/")) {
                return routes.route(req);
            }
            return json(HttpConstants.NOT_FOUND, HttpConstants.NOT_FOUND_BODY);
        } catch (Exception ex) {
            Log.error(LogTags.HTTP, req.method() + " " + req.path() + " failed: " + LogUnits.cause(ex), ex);
            return json(HttpConstants.INTERNAL, HttpConstants.INTERNAL_BODY);
        }
    }

    static long number(String json, String key, long dflt) {
        int i = json.indexOf("\"" + key + "\"");
        if (i < 0) {
            return dflt;
        }
        int c = json.indexOf(':', i);
        int e = json.indexOf(',', c);
        String num = json.substring(c + 1, e < 0 ? json.length() : e).replaceAll("[^0-9]", "");
        return num.isEmpty() ? dflt : Long.parseLong(num);
    }

    /** "key":[a,b] as {a, b}; null when the key is absent, empty when it is malformed. */
    static long[] pair(String json, String key) {
        int i = json.indexOf("\"" + key + "\"");
        if (i < 0) {
            return null;
        }
        int open = json.indexOf('[', i);
        int close = json.indexOf(']', i);
        if (open < 0 || close < open) {
            return new long[0];
        }
        String[] parts = json.substring(open + 1, close).split(",");
        try {
            return parts.length == 2
                    ? new long[]{Long.parseLong(parts[0].trim()), Long.parseLong(parts[1].trim())}
                    : new long[0];
        } catch (NumberFormatException ex) {
            return new long[0];
        }
    }

    static Response json(int code, String body) {
        return new Response(code, HttpConstants.JSON, body.getBytes(StandardCharsets.UTF_8));
    }
}
