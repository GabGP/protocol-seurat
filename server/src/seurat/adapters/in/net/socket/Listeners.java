package seurat.adapters.in.net.socket;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import seurat.adapters.in.net.http.HttpConstants;
import seurat.adapters.in.net.http.HttpSurface;
import seurat.core.shared.config.SeuratConfig;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

/** The TCP listener (TLS 1.3 from a PKCS#12 keystore when configured, pure JDK) and the raw HTTP answers on it. */
final class Listeners {
    private Listeners() {}

    static ServerSocket open(SeuratConfig config) throws Exception {
        if (!config.tls()) {
            return new ServerSocket(config.httpPort);
        }
        char[] password = config.tlsPassword.toCharArray();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(config.tlsKeystore)) {
            store.load(in, password);
        }
        KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keys.init(store, password);
        SSLContext tls = SSLContext.getInstance("TLSv1.3");
        tls.init(keys.getKeyManagers(), null, null);
        SSLServerSocket server = (SSLServerSocket) tls.getServerSocketFactory().createServerSocket(config.httpPort);
        server.setEnabledProtocols(new String[]{"TLSv1.3"});
        return server;
    }

    /** Writes one HTTP response and ends the connection (Connection: close, no-store unless set). */
    static void respond(Socket socket, HttpSurface.Response response) throws IOException {
        StringBuilder header = new StringBuilder("HTTP/1.1 ").append(status(response.code())).append(CRLF);
        if (response.code() != HttpConstants.NOT_MODIFIED) {
            header.append("Content-Type: ").append(response.type()).append(CRLF)
                    .append("Content-Length: ").append(response.body().length).append(CRLF);
        }
        header.append("Connection: close").append(CRLF);
        if (!response.headers().containsKey(HttpConstants.CACHE_CONTROL)) header.append("Cache-Control: no-store").append(CRLF);
        response.headers().forEach((k, v) -> header.append(k).append(": ").append(v).append(CRLF));
        OutputStream out = socket.getOutputStream();
        out.write(header.append(CRLF).toString().getBytes(StandardCharsets.UTF_8));
        if (response.code() != HttpConstants.NOT_MODIFIED) {
            out.write(response.body());
        }
        out.flush();
        closeGracefully(socket);
    }

    /** An empty answer that ends the connection: a refused upgrade or an unparsable request. */
    static void refuse(Socket socket, int code) throws IOException {
        socket.getOutputStream().write(("HTTP/1.1 " + status(code) + CRLF + "Content-Length: 0" + CRLF + "Connection: close" + CRLF + CRLF)
                .getBytes(StandardCharsets.US_ASCII));
        closeGracefully(socket);
    }

    /**
     * Waits (bounded) for the browser to close first, then closes. Every answer carries Content-Length, so the
     * browser ends the exchange once it has the body; a server FIN sent while a large body is still in flight
     * can strand its tail (seen on Windows loopback), leaving the page waiting on a script that never finishes.
     */
    static void closeGracefully(Socket socket) {
        try (socket) {
            socket.setSoTimeout(HttpConstants.CLOSE_LINGER_MS);
            InputStream in = socket.getInputStream();
            byte[] sink = new byte[HttpConstants.CLOSE_DRAIN_BYTES];
            while (in.read(sink) >= 0) { /* discard until the browser closes */ }
        } catch (IOException e) {
            // Timed out or reset by the peer: the socket is closed anyway.
        }
    }

    static String status(int code) {
        return switch (code) {
            case 200 -> "200 OK";
            case 201 -> "201 Created";
            case 202 -> "202 Accepted";
            case 304 -> "304 Not Modified";
            case 400 -> "400 Bad Request";
            case 401 -> "401 Unauthorized";
            case 403 -> "403 Forbidden";
            case 500 -> "500 Internal Error";
            default -> "404 Not Found";
        };
    }
}
