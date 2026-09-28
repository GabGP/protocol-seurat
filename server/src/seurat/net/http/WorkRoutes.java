package seurat.net.http;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import seurat.catalog.Catalog;
import seurat.catalog.RolePolicy;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConfig;
import seurat.observe.Log;

/** PUT/DELETE /seurat/v1/obras/{id} + PUT .../politica (spec 3.1). Admin only. */
final class WorkRoutes {
    private static final String PREFIX = "/seurat/v1/obras/";
    private static final int COPY_BUFFER = 1 << 16;
    private final Catalog catalog;
    private final SeuratConfig config;
    private final BiConsumer<String, Path> onMaster;
    private final Consumer<String> onPolicy;
    private final Consumer<String> onWithdraw;

    WorkRoutes(Catalog catalog, SeuratConfig config, BiConsumer<String, Path> onMaster,
            Consumer<String> onPolicy, Consumer<String> onWithdraw) {
        this.catalog = catalog;
        this.config = config;
        this.onMaster = onMaster;
        this.onPolicy = onPolicy;
        this.onWithdraw = onWithdraw;
    }

    static boolean isMasterUpload(String path) {
        return path.startsWith(PREFIX) && path.length() > PREFIX.length()
                && path.indexOf('/', PREFIX.length()) < 0;
    }

    HttpSurface.Response route(HttpSurface.Request req) throws Exception {
        String rest = req.path().substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String id = slash < 0 ? rest : rest.substring(0, slash);
        String tail = slash < 0 ? "" : rest.substring(slash);
        if (!req.headers().getOrDefault("x-admin-token", "").equals(config.adminToken)) {
            Log.warn("admin", "Unauthorized admin attempt on " + req.method() + " " + req.path());
            return HttpSurface.json(403, "{\"error\":\"admin\"}");
        }
        if (id.isEmpty() || id.contains("..") || id.contains("\\")) {
            return HttpSurface.json(404, "{\"error\":\"no existe\"}");
        }
        if (req.method().equals("PUT") && tail.isEmpty()) {
            Path file = config.inbox.resolve(id);
            long bytes = store(req, file);
            Log.info("admin", "Admin uploaded master for work '" + id + "' (" + bytes + " B)");
            onMaster.accept(id, file);
            return HttpSurface.json(202, "{\"estado\":\"recibiendo\"}");
        }
        if (req.method().equals("PUT") && tail.equals("/politica")) {
            return applyPolicy(id, new String(req.body(), StandardCharsets.UTF_8));
        }
        if (req.method().equals("DELETE") && tail.isEmpty()) {
            Log.info("admin", "Admin withdrew work '" + id + "'");
            onWithdraw.accept(id);
            return HttpSurface.json(200, "{\"ok\":true}");
        }
        return HttpSurface.json(404, "{\"error\":\"no existe\"}");
    }

    /** Streaming upload (spec 3.1): at most one buffer of the master is ever in memory. */
    private static long store(HttpSurface.Request req, Path file) throws IOException {
        if (req.stream() == null) {
            Files.write(file, req.body());
            return req.body().length;
        }
        long left = req.length();
        byte[] buf = new byte[COPY_BUFFER];
        try (OutputStream out = Files.newOutputStream(file)) {
            InputStream in = req.stream();
            while (left > 0) {
                int n = in.read(buf, 0, (int) Math.min(buf.length, left));
                if (n < 0) {
                    throw new IOException("upload cut short: " + left + " B missing");
                }
                out.write(buf, 0, n);
                left -= n;
            }
        }
        return req.length();
    }

    /** Validated (RolePolicy) and persisted before any open canvas hears of it. */
    private HttpSurface.Response applyPolicy(String id, String body) throws IOException {
        WorkRecord work = catalog.get(id);
        if (work == null) {
            return HttpSurface.json(404, "{\"error\":\"no existe\"}");
        }
        Map<String, long[]> changes = new HashMap<>();
        for (String role : WorkRecord.ROLES) {
            long[] pair = HttpSurface.pair(body, role);
            if (pair != null) {
                changes.put(role, pair);
            }
        }
        Map<String, long[]> next = RolePolicy.merge(work.ceilings, changes);
        if (next == null) {
            return HttpSurface.json(400, "{\"error\":\"politica\"}");
        }
        catalog.policy(work, next);
        Log.info("admin", "Admin updated policy for work '" + id + "'");
        onPolicy.accept(id);
        return HttpSurface.json(200, "{\"ok\":true}");
    }
}
