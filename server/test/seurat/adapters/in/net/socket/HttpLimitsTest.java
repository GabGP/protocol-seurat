package seurat.adapters.in.net.socket;

import java.io.InputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

/** Pre-handshake input is bounded: an oversized line or too many headers ends the connection. */
public final class HttpLimitsTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("http-limits");
        int port = WsClient.serve(root, new Catalog(new DiskArchive(root.resolve("obras"))));
        TestKit.check(answer(port, "GET /").startsWith("HTTP/1.1 200"), "a plain request is served");
        String longLine = "GET /" + "a".repeat(SeuratConstants.HTTP_LINE_MAX + 100) + " HTTP/1.1" + CRLF + CRLF;
        TestKit.check(!answer(port, longLine).startsWith("HTTP/1.1 200"), "a line past the cap is dropped");
        String headers = "GET / HTTP/1.1" + CRLF + ("X-A: 1" + CRLF).repeat(SeuratConstants.HTTP_HEADERS_MAX + 5) + CRLF;
        TestKit.check(!answer(port, headers).startsWith("HTTP/1.1 200"), "headers past the cap are dropped");
        System.out.println("HttpLimitsTest OK");
    }

    /** Sends the raw request and returns what the server wrote before it closed (or went quiet). */
    private static String answer(int port, String request) throws Exception {
        String raw = request.endsWith(CRLF + CRLF) ? request : request + " HTTP/1.1" + CRLF + "Host: x" + CRLF + CRLF;
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(raw.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
            InputStream in = socket.getInputStream();
            byte[] head = new byte[12];
            int n = 0;
            try {
                int r;
                while (n < head.length && (r = in.read(head, n, head.length - n)) > 0) {
                    n += r;
                }
            } catch (java.io.IOException closedOrQuiet) {
                // reset by the server counts as dropped
            }
            return new String(head, 0, n, StandardCharsets.UTF_8);
        }
    }
}
