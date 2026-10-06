package seurat.adapters.in.net.socket;

import java.io.ByteArrayInputStream;
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
import javax.net.ssl.SSLSocket;
import seurat.adapters.in.net.http.HttpConstants;
import seurat.adapters.in.net.http.HttpSurface;
import seurat.core.shared.config.SeuratConfig;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

/** The TCP listener (plain socket with TLS layered on demand, pure JDK) and the raw HTTP answers on it. */
final class Listeners {
    /** First byte of a TLS record (0x16: Handshake). */
    static final int TLS_HANDSHAKE = 0x16;
    private static final String TLS_PROTOCOL = "TLSv1.3";

    private Listeners() {}

    static ServerSocket open(SeuratConfig config) throws IOException {
        return new ServerSocket(config.httpPort);
    }

    static SSLContext tls(SeuratConfig config, KeyStore fallback, char[] fallbackPassword) throws Exception {
        KeyStore store;
        char[] password;
        if (config.tls()) {
            password = config.tlsPassword.toCharArray();
            store = KeyStore.getInstance("PKCS12");
            try (InputStream in = Files.newInputStream(config.tlsKeystore)) {
                store.load(in, password);
            }
        } else {
            store = fallback;
            password = fallbackPassword;
        }
        KeyManagerFactory keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keys.init(store, password);
        SSLContext tls = SSLContext.getInstance(TLS_PROTOCOL);
        tls.init(keys.getKeyManagers(), null, null);
        return tls;
    }

    static SSLSocket secure(SSLContext tls, Socket socket, int firstByte) throws IOException {
        SSLSocket secure = (SSLSocket) tls.getSocketFactory().createSocket(
                socket, new ByteArrayInputStream(new byte[]{(byte) firstByte}), true);
        secure.setUseClientMode(false);
        secure.setEnabledProtocols(new String[]{TLS_PROTOCOL});
        return secure;
    }

    /** Writes one HTTP response and ends the connection (Connection: close, no-store unless set). */
    static void respond(Socket socket, HttpSurface.Response response) throws IOException {
        StringBuilder header = new StringBuilder("HTTP/1.1 ").append(status(response.code())).append(CRLF);
        if (response.stream() != null) {
            header.append("Content-Type: ").append(response.type()).append(CRLF)
                    .append(HttpConstants.TRANSFER_ENCODING).append(": ").append(HttpConstants.CHUNKED).append(CRLF);
        } else if (response.code() != HttpConstants.NOT_MODIFIED) {
            header.append("Content-Type: ").append(response.type()).append(CRLF)
                    .append("Content-Length: ").append(response.body().length).append(CRLF);
        }
        header.append("Connection: close").append(CRLF);
        if (!response.headers().containsKey(HttpConstants.CACHE_CONTROL)) header.append("Cache-Control: no-store").append(CRLF);
        response.headers().forEach((k, v) -> header.append(k).append(": ").append(v).append(CRLF));
        OutputStream out = socket.getOutputStream();
        out.write(header.append(CRLF).toString().getBytes(StandardCharsets.UTF_8));
        if (response.stream() != null) {
            out.flush();
            ChunkedOutput chunked = new ChunkedOutput(out);
            try {
                response.stream().write(chunked);
            } finally {
                try {
                    chunked.close();
                } catch (IOException ignored) {}
            }
        } else if (response.code() != HttpConstants.NOT_MODIFIED) {
            out.write(response.body());
            out.flush();
        } else {
            out.flush();
        }
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
            case 409 -> "409 Conflict";
            case 411 -> "411 Length Required";
            case 415 -> "415 Unsupported Media Type";
            case 500 -> "500 Internal Error";
            case 502 -> "502 Bad Gateway";
            case 507 -> "507 Insufficient Storage";
            default -> "404 Not Found";
        };
    }
}
