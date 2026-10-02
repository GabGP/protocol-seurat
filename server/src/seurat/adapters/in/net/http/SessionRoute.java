package seurat.adapters.in.net.http;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.viewing.session.Sessions;

/**
 * POST /seurat/v1/sesion (spec 3.1 with ADR-05): no authentication; issues a single-use
 * 32 B token that expires in 120 s, plus the mapping URLs (only the WebSocket one is served,
 * so `lienzo` names it too and the viewer goes straight to it, spec 8 "UDP bloqueado"), and
 * `local` (the viewer uses it to show the path-import tab per ADR-04; informational only, the server
 * re-checks on every intake call). The cookie names the principal so SALUDO REANUDAR can check it.
 * No other state is created.
 */
final class SessionRoute {
    static final String ANON_COOKIE = "seurat_anon";
    private static final int ANON_BYTES = 16;

    private final Sessions sessions;
    private final SeuratConfig config;
    private final SecureRandom random = new SecureRandom();

    SessionRoute(Sessions sessions, SeuratConfig config) {
        this.sessions = sessions;
        this.config = config;
    }

    HttpSurface.Response issue(HttpSurface.Request req) {
        String body = new String(req.body(), StandardCharsets.UTF_8);
        long memMib = HttpSurface.number(body, "memMiB", SeuratConstants.DEFAULT_MEM_MIB);
        String anon = anonymousId(req.headers().getOrDefault("cookie", ""));
        boolean fresh = anon == null;
        if (fresh) {
            anon = HexFormat.of().formatHex(bytes());
        }
        String principal = "viewer-" + anon;
        String token = sessions.issueToken(principal, memMib, SeuratConstants.TOKEN_TTL_S * Units.MS_PER_S);
        Log.info(LogTags.SESSION, "token issued principal=" + principal);
        String host = req.host();
        String ws = (config.tls() ? "wss://" : "ws://") + host + "/seurat/v1/lienzo-ws";
        String json = "{\"token\":\"" + token + "\",\"lienzo\":\"" + ws
                + "\",\"respaldo\":\"" + ws + "\",\"versiones\":[1],\"lado\":" + SeuratConstants.BRUSH_SIDE
                + ",\"local\":" + req.local() + "}";
        Map<String, String> headers = fresh
                ? Map.of("Set-Cookie", ANON_COOKIE + "=" + anon + "; Path=/; HttpOnly; SameSite=Strict")
                : Map.of();
        return new HttpSurface.Response(HttpConstants.CREATED, HttpConstants.JSON, json.getBytes(StandardCharsets.UTF_8), headers);
    }

    private byte[] bytes() {
        byte[] b = new byte[ANON_BYTES];
        random.nextBytes(b);
        return b;
    }

    /** The anonymous viewer id from its cookie, if well-formed. */
    private static String anonymousId(String cookies) {
        for (String part : cookies.split(";")) {
            String p = part.trim();
            if (p.startsWith(ANON_COOKIE + "=")) {
                String v = p.substring(ANON_COOKIE.length() + 1);
                return v.matches("[0-9a-f]{" + (2 * ANON_BYTES) + "}") ? v : null;
            }
        }
        return null;
    }
}
