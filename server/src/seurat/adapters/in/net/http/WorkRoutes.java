package seurat.adapters.in.net.http;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.function.Consumer;
import seurat.adapters.in.inbox.IntakeRefused;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.works.catalog.Catalog;

/** PUT and DELETE /seurat/v1/obras/{id} (spec 3.1, ADR-04, ADR-05): open to any viewer from the same origin. */
final class WorkRoutes {
    private static final String PREFIX = "/seurat/v1/obras/";
    private final Catalog catalog;
    private final SeuratConfig config;
    private final IntakePorts ports;
    private final Consumer<String> onWithdraw;

    WorkRoutes(Catalog catalog, SeuratConfig config, IntakePorts ports,
            Consumer<String> onWithdraw) {
        this.catalog = catalog;
        this.config = config;
        this.ports = ports;
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
        if (req.method().equals("PUT") && tail.isEmpty()) {
            if (!IntakeGate.sameOrigin(req, config)) {
                return HttpSurface.json(HttpConstants.FORBIDDEN, "{\"error\":\"origin\"}");
            }
            try {
                byte[] body = req.body() != null ? req.body() : new byte[0];
                InputStream stream = req.stream() != null ? req.stream() : new ByteArrayInputStream(body);
                long length = req.stream() != null ? req.length() : body.length;
                // The viewer sends encodeURIComponent(file.name): the work id is the decoded stem.
                Path path = ports.upload().store(URLDecoder.decode(id, StandardCharsets.UTF_8), stream, length);
                ports.arrived().accept(path);
                String name = path.getFileName().toString();
                return HttpSurface.json(HttpConstants.ACCEPTED,
                        "{\"estado\":\"recibiendo\",\"nombre\":\"" + IntakeGate.escapeJson(name) + "\"}");
            } catch (IntakeRefused ex) {
                return IntakeGate.refused(ex);
            }
        }
        if (req.method().equals("DELETE") && tail.isEmpty()) {
            if (!IntakeGate.sameOrigin(req, config)) {
                return HttpSurface.json(HttpConstants.FORBIDDEN, "{\"error\":\"origin\"}");
            }
            if (id.isEmpty() || id.contains("..") || id.contains("\\")) {
                return HttpSurface.json(HttpConstants.NOT_FOUND, HttpConstants.NOT_FOUND_BODY);
            }
            Log.info(LogTags.INGEST, LogTags.work(id) + " withdrawn");
            onWithdraw.accept(id);
            return HttpSurface.json(HttpConstants.OK, "{\"ok\":true}");
        }
        return HttpSurface.json(HttpConstants.NOT_FOUND, HttpConstants.NOT_FOUND_BODY);
    }
}
