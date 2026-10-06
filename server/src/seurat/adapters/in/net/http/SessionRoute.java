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
 * 32 B token that expires in 120 s, plus the mapping URLs: when WebTransport is up, `lienzo`
 * names the https/QUIC URL and `huella` carries the certificate SHA-256 so the viewer pins
 * the listener's self-signed certificate (serverCertificateHashes, nothing installed); otherwise
 * `lienzo` names the WebSocket URL. In both cases `respaldo` names WebSocket (spec 8 "UDP bloqueado").
 * Also reports `local` (ADR-04). The cookie names the principal so SALUDO REANUDAR can check it.
 * No other state is created.
 */
final class SessionRoute {
    static final String ANON_COOKIE = "seurat_anon";
    private static final int ANON_BYTES = 16;

    private final Sessions sessions;
    private final SeuratConfig config;
    private final SecureRandom random = new SecureRandom();
    /** SHA-256 (hex) of the WebTransport certificate once that listener is up; empty = WebSocket only. */
    private volatile String pin = "";

    SessionRoute(Sessions sessions, SeuratConfig config) {
        this.sessions = sessions;
        this.config = config;
    }

    void webtransport(String certificateSha256) {
        pin = certificateSha256;
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
        String ws = (req.secure() ? "wss://" : "ws://") + host + SeuratConstants.WT_PATH + "-ws";
        String lienzo = pin.isEmpty() ? ws : "https://" + host + SeuratConstants.WT_PATH;
        String huella = pin.isEmpty() ? "" : ",\"huella\":\"" + pin + "\"";
        String json = "{\"token\":\"" + token + "\",\"lienzo\":\"" + lienzo + "\"" + huella
                + ",\"respaldo\":\"" + ws + "\",\"versiones\":[1],\"lado\":" + SeuratConstants.BRUSH_SIDE
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
