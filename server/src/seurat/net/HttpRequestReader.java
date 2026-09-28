package seurat.net;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/** The request line and headers of one HTTP/1.1 request; the body stays on the stream. */
record HttpRequestReader(String line, String[] parts, Map<String, String> headers) {
    /** Null when the peer closed before a request line. Headers of a malformed line are left unread. */
    static HttpRequestReader read(InputStream in) throws Exception {
        String line = SocketIo.readLine(in);
        if (line == null) {
            return null;
        }
        String[] parts = line.split(" ", 3);
        Map<String, String> headers = new HashMap<>();
        if (parts.length >= 2) {
            String header;
            while ((header = SocketIo.readLine(in)) != null && !header.isEmpty()) {
                int colon = header.indexOf(':');
                if (colon > 0) {
                    headers.put(header.substring(0, colon).trim().toLowerCase(), header.substring(colon + 1).trim());
                }
            }
        }
        return new HttpRequestReader(line, parts, headers);
    }

    boolean valid() {
        return parts.length >= 2;
    }

    long contentLength() {
        try {
            return Math.max(0, Long.parseLong(headers.getOrDefault("content-length", "0")));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }
}
