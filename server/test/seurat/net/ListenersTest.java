package seurat.net;

import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import seurat.kit.TestKit;
import seurat.net.http.HttpConstants;
import seurat.net.http.HttpSurface;

/** Verifies HTTP response formatting, status phrase mapping and 304 headers. */
public final class ListenersTest {
    public static void main(String[] args) throws Exception {
        TestKit.check(Listeners.status(200).equals("200 OK"), "200 status text");
        TestKit.check(Listeners.status(304).equals("304 Not Modified"), "304 status text");
        TestKit.check(Listeners.status(404).equals("404 Not Found"), "404 status text");

        try (ServerSocket server = new ServerSocket(0)) {
            int port = server.getLocalPort();
            AtomicReference<String> got = new AtomicReference<>();
            Thread clientThread = Thread.ofVirtual().start(() -> {
                try (Socket client = new Socket("127.0.0.1", port)) {
                    got.set(new String(client.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
                } catch (Exception ex) {
                    throw new RuntimeException(ex);
                }
            });
            try (Socket s = server.accept()) {
                Listeners.respond(s, new HttpSurface.Response(HttpConstants.NOT_MODIFIED,
                        HttpConstants.HTML, new byte[]{1, 2, 3},
                        Map.of(HttpConstants.CACHE_CONTROL, HttpConstants.NO_CACHE,
                                HttpConstants.ETAG, "\"test-etag\"")));
            }
            clientThread.join();
            String raw = got.get();
            TestKit.check(raw != null && raw.startsWith("HTTP/1.1 304 Not Modified\r\n"), "304 status line");
            TestKit.check(!raw.contains("Content-Type"), "304 omits Content-Type");
            TestKit.check(!raw.contains("Content-Length"), "304 omits Content-Length");
            TestKit.check(raw.contains("ETag: \"test-etag\"\r\n"), "304 carries ETag");
            TestKit.check(raw.contains("Cache-Control: no-cache\r\n"), "304 carries Cache-Control");
            TestKit.check(raw.endsWith("\r\n\r\n"), "304 has empty body");
        }

        System.out.println("ListenersTest OK");
    }
}
