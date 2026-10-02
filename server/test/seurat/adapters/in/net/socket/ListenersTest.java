package seurat.adapters.in.net.socket;

import java.io.ByteArrayOutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import seurat.adapters.in.net.http.HttpConstants;
import seurat.adapters.in.net.http.HttpSurface;
import seurat.kit.TestKit;

/** Verifies HTTP response formatting, status phrase mapping and 304 headers. */
public final class ListenersTest {
    public static void main(String[] args) throws Exception {
        TestKit.check(Listeners.status(200).equals("200 OK"), "200 status text");
        TestKit.check(Listeners.status(304).equals("304 Not Modified"), "304 status text");
        TestKit.check(Listeners.status(404).equals("404 Not Found"), "404 status text");

        var baos = new ByteArrayOutputStream();
        try (var chunked = new ChunkedOutput(baos)) {
            chunked.write("hello".getBytes(StandardCharsets.US_ASCII));
            chunked.write("world!".getBytes(StandardCharsets.US_ASCII));
        }
        byte[] expectedBytes = "5\r\nhello\r\n6\r\nworld!\r\n0\r\n\r\n".getBytes(StandardCharsets.US_ASCII);
        TestKit.check(Arrays.equals(baos.toByteArray(), expectedBytes), "ChunkedOutput frames two writes and terminator");

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
                Listeners.respond(s, new HttpSurface.Response(HttpConstants.OK,
                        HttpConstants.NDJSON, new byte[0], Map.of(),
                        out -> out.write("{\"line\":1}\n".getBytes(StandardCharsets.UTF_8))));
            }
            clientThread.join();
            String raw = got.get();
            TestKit.check(raw.contains("Transfer-Encoding: chunked\r\n"), "chunked header");
            TestKit.check(!raw.contains("Content-Length"), "no Content-Length header");
            TestKit.check(raw.contains("{\"line\":1}\n"), "streamed content present");
            TestKit.check(raw.endsWith("0\r\n\r\n"), "ends with chunked terminator");
        }

        System.out.println("ListenersTest OK");
    }
}
