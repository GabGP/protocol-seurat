package seurat.net.http;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConfig;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.session.Sessions;

/**
 * HTTP routes. Only handshake and intake live here; points never do.
 * Single egress stays paint/Painter over PINCELADA flows.
 */
public final class HttpSurface {
    public record Request(String method, String path, Map<String, String> headers,
            byte[] body, String host) {}
    public record Response(int code, String type, byte[] body) {}

    private final StaticFiles files;
    private final Sessions sessions;
    private final WorkRoutes routes;

    public HttpSurface(Path staticRoot, Sessions sessions, Catalog catalog,
            SeuratConfig config, BiConsumer<String, Path> onMaster,
            Consumer<String> onPolicy, Consumer<String> onWithdraw) {
        this.files = new StaticFiles(staticRoot);
        this.sessions = sessions;
        this.routes = new WorkRoutes(catalog, config, onMaster, onPolicy, onWithdraw);
    }

    public Response route(Request req) {
        try {
            if (req.method().equals("GET") || req.method().equals("HEAD")) {
                return staticGet(req.path());
            }
            if (req.method().equals("POST") && req.path().equals("/seurat/v1/sesion")) {
                return newSession(req);
            }
            if (req.path().startsWith("/seurat/v1/obras/")) {
                return obras(req);
            }
            return json(404, "{\"error\":\"no existe\"}");
        } catch (Exception ex) {
            Log.error("http", "Error routing request " + req.method() + " " + req.path(), ex);
            return json(500, "{\"error\":\"interno\"}");
        }
    }

    private Response staticGet(String target) throws Exception {
        int query = target.indexOf('?');
        String path = query < 0 ? target : target.substring(0, query); // `?` names no file
        byte[] body = files.get(path);
        if (body == null) {
            return json(404, "{\"error\":\"no existe\"}");
        }
        String type = (!path.contains(".") || path.equals("/"))
                ? "text/html; charset=utf-8"
                : StaticFiles.contentType(path);
        return new Response(200, type, body);
    }

    private Response newSession(Request req) {
        String body = new String(req.body(), StandardCharsets.UTF_8);
        long memMib = number(body, "memMiB", 128);
        String auth = req.headers().getOrDefault("authorization", "");
        boolean authed = auth.startsWith("Bearer ") && auth.length() > 7;
        String role = authed ? WorkRecord.AUTHENTICATED : WorkRecord.ANONYMOUS;
        String principal = authed ? "bearer-" + auth.substring(7, Math.min(15, auth.length()))
                : "anonimo";
        String token = sessions.issueToken(principal, role, memMib,
                SeuratConstants.TOKEN_TTL_S * 1000);
        Log.info("session", "Issued session token for principal=" + principal
                + " (role=" + role + ", mem=" + memMib + "MiB)");
        String base = "ws://" + req.host();
        String json = "{\"token\":\"" + token + "\",\"lienzo\":\"" + base
                + "/seurat/v1/lienzo-ws\",\"respaldo\":\"" + base
                + "/seurat/v1/lienzo-ws\",\"versiones\":[1],\"lado\":256}";
        return json(201, json);
    }

    private Response obras(Request req) throws Exception {
        return routes.route(req);
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

    static long[] pair(String json, String key) {
        int i = json.indexOf("\"" + key + "\"");
        if (i < 0) {
            return null;
        }
        String sub = json.substring(json.indexOf('[', i), json.indexOf(']', i) + 1)
                .replaceAll("[^0-9,]", "");
        String[] parts = sub.split(",");
        if (parts.length != 2) {
            return null;
        }
        return new long[]{Long.parseLong(parts[0]), Long.parseLong(parts[1])};
    }

    static Response json(int code, String body) {
        return new Response(code, "application/json", body.getBytes(StandardCharsets.UTF_8));
    }
}
