package seurat.adapters.in.net.http;

import java.util.Locale;
import seurat.adapters.in.inbox.IntakeRefused;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;

/** Origin verification and error mapping for HTTP intake requests. */
final class IntakeGate {
    private IntakeGate() {}

    static boolean sameOrigin(HttpSurface.Request req, SeuratConfig config) {
        String origin = ETags.header(req.headers(), "origin");
        if (origin == null || origin.isBlank()) {
            return true;
        }
        String host = req.host();
        if (host != null && (origin.equals("http://" + host) || origin.equals("https://" + host))) {
            return true;
        }
        return config != null && config.origins != null && config.origins.contains(origin);
    }

    static int status(IntakeRefused.Reason r) {
        if (r == null) {
            return HttpConstants.BAD_REQUEST;
        }
        return switch (r) {
            case UNSUPPORTED -> HttpConstants.UNSUPPORTED_MEDIA;
            case EXISTS -> HttpConstants.CONFLICT;
            case NO_SPACE -> HttpConstants.INSUFFICIENT_STORAGE;
            case BAD_LENGTH -> HttpConstants.LENGTH_REQUIRED;
            case NOT_LOCAL_FILE -> HttpConstants.BAD_REQUEST;
            case UPSTREAM -> HttpConstants.BAD_GATEWAY;
        };
    }

    static HttpSurface.Response refused(IntakeRefused ex) {
        int status = status(ex.reason());
        String err = ex.reason() != null ? ex.reason().name().toLowerCase(Locale.ROOT) : "refused";
        Log.warn(LogTags.HTTP, "intake refused: " + ex.getMessage());
        return HttpSurface.json(status, "{\"error\":\"" + err + "\"}");
    }

    static String escapeJson(String s) {
        if (s == null) {
            return "";
        }
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
