package seurat.adapters.in.net.http;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Locale;
import seurat.adapters.in.inbox.IntakeRefused;
import seurat.adapters.in.inbox.PathImport;
import seurat.core.shared.config.SeuratConfig;

/** Handles POST /seurat/v1/importar for remote URL downloads and local file imports. */
final class ImportRoute {
    private final SeuratConfig config;
    private final IntakePorts ports;

    ImportRoute(SeuratConfig config, IntakePorts ports) {
        this.config = config;
        this.ports = ports;
    }

    HttpSurface.Response route(HttpSurface.Request req) throws IOException {
        if (!IntakeGate.sameOrigin(req, config)) {
            return HttpSurface.json(HttpConstants.FORBIDDEN, "{\"error\":\"origin\"}");
        }
        byte[] body = req.body() != null ? req.body() : new byte[0];
        String text = new String(body, StandardCharsets.UTF_8).trim();
        if (text.isEmpty()) {
            return HttpSurface.json(HttpConstants.BAD_REQUEST, "{\"error\":\"vacio\"}");
        }
        String lower = text.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            return fetchLink(text);
        }
        if (!req.local()) {
            return HttpSurface.json(HttpConstants.FORBIDDEN, "{\"error\":\"solo local\"}");
        }
        return linkPath(text);
    }

    private HttpSurface.Response fetchLink(String url) throws IOException {
        try {
            Path path = ports.links().fetch(url);
            ports.arrived().accept(path);
            String name = IntakeGate.escapeJson(path.getFileName().toString());
            return HttpSurface.json(HttpConstants.ACCEPTED,
                    "{\"nombre\":\"" + name + "\",\"modo\":\"descarga\"}");
        } catch (IntakeRefused ex) {
            return IntakeGate.refused(ex);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            return HttpSurface.json(HttpConstants.INTERNAL, HttpConstants.INTERNAL_BODY);
        }
    }

    private HttpSurface.Response linkPath(String pathStr) throws IOException {
        try {
            PathImport.Result res = ports.paths().link(pathStr);
            ports.arrived().accept(res.inbox());
            String name = IntakeGate.escapeJson(res.inbox().getFileName().toString());
            String modo = res.copied() ? "copia" : "enlace";
            return HttpSurface.json(HttpConstants.ACCEPTED,
                    "{\"nombre\":\"" + name + "\",\"modo\":\"" + modo + "\"}");
        } catch (IntakeRefused ex) {
            return IntakeGate.refused(ex);
        }
    }
}
