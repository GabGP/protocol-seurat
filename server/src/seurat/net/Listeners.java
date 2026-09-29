package seurat.net;

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
import seurat.config.SeuratConfig;
import static seurat.net.http.HttpConstants.CRLF;
import seurat.net.http.HttpSurface;

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
        StringBuilder header = new StringBuilder("HTTP/1.1 " + status(response.code())
                + CRLF + "Content-Type: " + response.type() + CRLF + "Content-Length: " + response.body().length
                + CRLF + "Connection: close" + CRLF);
        if (!response.headers().containsKey(HttpSurface.CACHE_CONTROL)) header.append("Cache-Control: no-store" + CRLF);
        response.headers().forEach((k, v) -> header.append(k).append(": ").append(v).append(CRLF));
        OutputStream out = socket.getOutputStream();
        out.write(header.append(CRLF).toString().getBytes(StandardCharsets.UTF_8));
        out.write(response.body());
        out.flush();
        socket.close();
    }

    /** An empty answer that ends the connection: a refused upgrade or an unparsable request. */
    static void refuse(Socket socket, int code) throws IOException {
        socket.getOutputStream().write(("HTTP/1.1 " + status(code) + CRLF + "Content-Length: 0" + CRLF + "Connection: close" + CRLF + CRLF)
                .getBytes(StandardCharsets.US_ASCII));
        socket.close();
    }

    static String status(int code) {
        return switch (code) {
            case 200 -> "200 OK";
            case 201 -> "201 Created";
            case 202 -> "202 Accepted";
            case 400 -> "400 Bad Request";
            case 401 -> "401 Unauthorized";
            case 403 -> "403 Forbidden";
            case 500 -> "500 Internal Error";
            default -> "404 Not Found";
        };
    }
}
