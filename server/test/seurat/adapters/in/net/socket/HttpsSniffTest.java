package seurat.adapters.in.net.socket;

import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.cert.X509Certificate;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import seurat.adapters.out.disk.DiskArchive;
import seurat.core.works.catalog.Catalog;
import seurat.kit.TestKit;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

/** One TCP port answers http and https: the first byte of a connection tells them apart. */
public final class HttpsSniffTest {
    private static final String OK = "HTTP/1.1 200";
    private static final int TIMEOUT_MS = 5000;

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("https-sniff");
        int port = WsClient.serve(root, new Catalog(new DiskArchive(root.resolve("obras"))));
        SSLContext trusting = trustEverything();

        TestKit.check(exchange(plain(port), get(port)).startsWith(OK), "http GET is served");
        try (SSLSocket tls = tls(trusting, port)) {
            TestKit.check(tls.getSession().getProtocol().equals("TLSv1.3"), "https is TLS 1.3");
            TestKit.check(exchange(tls, get(port)).startsWith(OK), "https GET is served on the same port");
        }
        TestKit.check(exchange(plain(port), session(port, "http")).contains("\"respaldo\":\"ws://"),
                "a plain session gets the ws fallback");
        TestKit.check(exchange(tls(trusting, port), session(port, "https")).contains("\"respaldo\":\"wss://"),
                "a TLS session gets the wss fallback");

        plain(port).close();
        TestKit.check(exchange(plain(port), get(port)).startsWith(OK), "a silent connection does not stop http");
        try (Socket half = plain(port)) {
            half.getOutputStream().write(Listeners.TLS_HANDSHAKE);
            half.getOutputStream().flush();
        }
        TestKit.check(exchange(tls(trusting, port), get(port)).startsWith(OK), "a cut handshake does not stop https");
        System.out.println("HttpsSniffTest OK");
    }

    private static String get(int port) {
        return "GET / HTTP/1.1" + CRLF + "Host: localhost:" + port + CRLF + CRLF;
    }

    private static String session(int port, String scheme) {
        return "POST /seurat/v1/sesion HTTP/1.1" + CRLF + "Host: localhost:" + port + CRLF
                + "Origin: " + scheme + "://localhost:" + port + CRLF
                + "Content-Type: application/json" + CRLF + "Content-Length: 2" + CRLF + CRLF + "{}";
    }

    private static Socket plain(int port) throws Exception {
        return new Socket("127.0.0.1", port);
    }

    private static SSLSocket tls(SSLContext context, int port) throws Exception {
        SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket("127.0.0.1", port);
        socket.setSoTimeout(TIMEOUT_MS);
        socket.startHandshake();
        return socket;
    }

    /** Sends the raw request and returns everything the server wrote before it closed. */
    private static String exchange(Socket socket, String request) throws Exception {
        try (socket) {
            socket.setSoTimeout(TIMEOUT_MS);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.UTF_8));
            socket.getOutputStream().flush();
            socket.shutdownOutput(); // the server lingers until the client is done sending
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /** Test only: the server's certificate is self-signed, so the client accepts whatever it presents. */
    private static SSLContext trustEverything() throws Exception {
        SSLContext context = SSLContext.getInstance("TLSv1.3");
        context.init(null, new TrustManager[]{new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType) {}

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType) {}

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        }}, null);
        return context;
    }
}
