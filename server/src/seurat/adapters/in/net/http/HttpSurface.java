package seurat.adapters.in.net.http;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.function.Consumer;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;

/**
 * HTTP routes (spec 3.1). Only handshake and intake live here; points never do:
 * the single egress stays paint/Painter over PINCELADA flows.
 */
public final class HttpSurface {
    @FunctionalInterface
    public interface BodyWriter {
        void write(OutputStream out) throws IOException;
    }

    /**
     * An HTTP request. Body is read up front, except a master upload, which streams
     * (length bytes from stream). {@code local} is true when the HTTP peer is on the
     * same machine as the server.
     */
    public record Request(String method, String path, Map<String, String> headers,
            byte[] body, String host, InputStream stream, long length, boolean local, boolean secure) {
        public Request(String method, String path, Map<String, String> headers, byte[] body, String host) {
            this(method, path, headers, body, host, null, body.length, false, false);
        }

        public Request(String method, String path, Map<String, String> headers,
                byte[] body, String host, InputStream stream, long length) {
            this(method, path, headers, body, host, stream, length, false, false);
        }

        public Request(String method, String path, Map<String, String> headers,
                byte[] body, String host, InputStream stream, long length, boolean local) {
            this(method, path, headers, body, host, stream, length, local, false);
        }
    }

    public record Response(int code, String type, byte[] body, Map<String, String> headers, BodyWriter stream) {
        public Response(int code, String type, byte[] body, Map<String, String> headers) {
            this(code, type, body, headers, null);
        }

        public Response(int code, String type, byte[] body) {
            this(code, type, body, Map.of(), null);
        }
    }

    private final StaticRoute statics;
    private final SessionRoute session;
    private final ImportRoute importRoute;
    private final WorkRoutes routes;

    public HttpSurface(Path staticRoot, Sessions sessions, Catalog catalog,
            SeuratConfig config, IntakePorts intake,
            Consumer<String> onWithdraw) {
        this.statics = new StaticRoute(staticRoot);
        this.session = new SessionRoute(sessions, config);
        this.importRoute = new ImportRoute(config, intake);
        this.routes = new WorkRoutes(catalog, config, intake, onWithdraw);
    }

    /** The WebTransport listener is up: POST /sesion announces it with its certificate hash. */
    public void announceWebTransport(String certificateSha256) {
        session.webtransport(certificateSha256);
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
            if (req.method().equals("POST") && req.path().equals("/seurat/v1/importar")) {
                return importRoute.route(req);
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

    static Response json(int code, String body) {
        return new Response(code, HttpConstants.JSON, body.getBytes(StandardCharsets.UTF_8));
    }
}
