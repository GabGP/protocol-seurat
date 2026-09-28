package seurat.net.ws;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/** RFC 6455 handshake for the seurat.1 mapping (spec 3.1, 3.5, 9.2): route, subprotocol, Origin. */
public final class WsHandshake {
    private WsHandshake() {}

    public static final String PATH = "/seurat/v1/lienzo-ws";
    public static final String SUBPROTOCOL = "seurat.1";

    public static boolean isUpgrade(String[] parts, Map<String, String> headers) {
        return parts.length == 3 && parts[0].equals("GET") && parts[1].equals(PATH)
                && headers.getOrDefault("upgrade", "").equalsIgnoreCase("websocket");
    }

    /** The major version travels in the subprotocol name: the client must offer seurat.1. */
    public static boolean offersSubprotocol(Map<String, String> headers) {
        return Arrays.stream(headers.getOrDefault("sec-websocket-protocol", "").split(","))
                .map(String::trim).anyMatch(SUBPROTOCOL::equals);
    }

    /**
     * CSWSH defense (spec 3.1, 9.2: the upgrade checks Origin): it must be this server (same
     * host) or one the operator allowed. A browser always sends it; an upgrade without one is refused.
     */
    public static boolean originAllowed(Map<String, String> headers, List<String> allowed) {
        String origin = headers.get("origin");
        if (origin == null) {
            return false;
        }
        if (allowed.contains(origin)) {
            return true;
        }
        try {
            URI u = URI.create(origin);
            String authority = u.getPort() < 0 ? u.getHost() : u.getHost() + ":" + u.getPort();
            return authority != null && authority.equalsIgnoreCase(headers.getOrDefault("host", ""));
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    public static String acceptKey(String key) throws Exception {
        return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-1")
                .digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.UTF_8)));
    }
}
