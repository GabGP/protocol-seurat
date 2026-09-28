package seurat.net.http;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConfig;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.config.ViewerAccounts;
import seurat.observe.Log;
import seurat.session.Sessions;

/**
 * POST /seurat/v1/sesion (spec 3.1, 3.4.1): authenticates (a Bearer key from
 * `auth.accounts`, 401 if unknown; without one, an anonymous cookie so the brush budget
 * is per viewer) and issues a single-use 32 B token that expires in 120 s, plus the mapping
 * URLs (only the WebSocket one is served, so `lienzo` names it too and the viewer goes straight
 * to it, spec 8 "UDP bloqueado"), the role (`rol`) and, when signed in, the account (`cuenta`)
 * so the viewer can say who it is. No other state is created.
 */
final class SessionRoute {
    static final String ANON_COOKIE = "seurat_anon";
    private static final int ANON_BYTES = 16;
    private static final String BEARER = "Bearer ";

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
        String auth = req.headers().getOrDefault("authorization", "");
        ViewerAccounts.Account account = null;
        if (!auth.isEmpty()) {
            account = auth.startsWith(BEARER) ? config.accounts.find(auth.substring(BEARER.length()).trim()) : null;
            if (account == null || !WorkRecord.ROLES.contains(account.role())) {
                Log.warn("session", "token refused: unknown Bearer key");
                return HttpSurface.json(401, "{\"error\":\"autenticacion\"}");
            }
        }
        String anon = account == null ? anonymousId(req.headers().getOrDefault("cookie", "")) : null;
        boolean fresh = account == null && anon == null;
        if (fresh) {
            anon = HexFormat.of().formatHex(bytes());
        }
        String role = account != null ? account.role() : WorkRecord.ANONYMOUS;
        String principal = account != null ? "user-" + account.name() : "anon-" + anon; // names a coverage directory
        String token = sessions.issueToken(principal, role, memMib, SeuratConstants.TOKEN_TTL_S * Units.MS_PER_S);
        Log.info("session", "token issued principal=" + principal + " role=" + role);
        String host = req.host();
        String ws = (config.tls() ? "wss://" : "ws://") + host + "/seurat/v1/lienzo-ws";
        String json = "{\"token\":\"" + token + "\",\"lienzo\":\"" + ws
                + "\",\"respaldo\":\"" + ws + "\",\"versiones\":[1],\"lado\":" + SeuratConstants.BRUSH_SIDE
                + ",\"rol\":\"" + role + "\"" + (account != null ? ",\"cuenta\":\"" + account.name() + "\"" : "") + "}";
        Map<String, String> headers = fresh
                ? Map.of("Set-Cookie", ANON_COOKIE + "=" + anon + "; Path=/; HttpOnly; SameSite=Strict")
                : Map.of();
        return new HttpSurface.Response(201, "application/json", json.getBytes(StandardCharsets.UTF_8), headers);
    }

    private byte[] bytes() {
        byte[] b = new byte[ANON_BYTES];
        random.nextBytes(b);
        return b;
    }

    /** The anonymous viewer id from its cookie, if well-formed (it names a coverage file). */
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
