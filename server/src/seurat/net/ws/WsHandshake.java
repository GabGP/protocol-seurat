package seurat.net.ws;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;

/** RFC 6455 handshake for the seurat.1 mapping: route match + accept key. */
public final class WsHandshake {
    private WsHandshake() {}

    public static boolean isUpgrade(String[] parts, Map<String, String> headers) {
        return parts.length == 3 && parts[0].equals("GET")
                && parts[1].equals("/seurat/v1/lienzo-ws")
                && headers.getOrDefault("upgrade", "").equalsIgnoreCase("websocket");
    }

    public static String acceptKey(String key) throws Exception {
        return Base64.getEncoder().encodeToString(MessageDigest
                .getInstance("SHA-1").digest(
                        (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
                                .getBytes(StandardCharsets.UTF_8)));
    }
}
