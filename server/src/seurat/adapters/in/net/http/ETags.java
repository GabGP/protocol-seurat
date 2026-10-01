package seurat.adapters.in.net.http;

import java.util.HexFormat;
import java.util.Map;
import java.util.zip.CRC32C;

/** Strong ETag calculation (RFC 9110 §8.8.3) and If-None-Match condition evaluation (§13.1.2). */
final class ETags {
    private ETags() {}

    /** Computes a strong quoted ETag from content bytes using CRC32C. */
    static String of(byte[] bytes) {
        CRC32C crc = new CRC32C();
        crc.update(bytes);
        return "\"" + HexFormat.of().toHexDigits((int) crc.getValue()) + "\"";
    }

    /** True when headers contain an If-None-Match matching the target ETag. */
    static boolean matches(Map<String, String> headers, String etag) {
        return matches(header(headers, HttpConstants.IF_NONE_MATCH), etag);
    }

    /** Weak comparison (RFC 9110 §13.1.2) for If-None-Match: handles comma-separated lists and '*'. */
    static boolean matches(String ifNoneMatch, String etag) {
        if (ifNoneMatch == null || ifNoneMatch.isBlank() || etag == null) {
            return false;
        }
        String target = stripWeak(etag.trim());
        for (String part : ifNoneMatch.split(",")) {
            String candidate = stripWeak(part.trim());
            if (candidate.equals("*") || candidate.equals(target)
                    || unquote(candidate).equals(unquote(target))) {
                return true;
            }
        }
        return false;
    }

    /** Case-insensitive header lookup; null when absent. */
    static String header(Map<String, String> headers, String name) {
        if (headers == null || headers.isEmpty()) {
            return null;
        }
        String val = headers.get(name);
        if (val != null) {
            return val;
        }
        for (var e : headers.entrySet()) {
            if (e.getKey().equalsIgnoreCase(name)) {
                return e.getValue();
            }
        }
        return null;
    }

    private static String stripWeak(String s) {
        return s.startsWith("W/") ? s.substring(2).trim() : s;
    }

    private static String unquote(String s) {
        return s.startsWith("\"") && s.endsWith("\"") && s.length() >= 2
                ? s.substring(1, s.length() - 1)
                : s;
    }
}
