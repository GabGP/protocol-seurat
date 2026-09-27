package seurat.net;

import java.io.InputStream;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLServerSocket;
import seurat.config.SeuratConfig;

/** The TCP listener: TLS 1.3 from a PKCS#12 keystore when configured (pure JDK), else plain. */
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

    static String status(int code) {
        return switch (code) {
            case 200 -> "200 OK";
            case 201 -> "201 Created";
            case 202 -> "202 Accepted";
            case 403 -> "403 Forbidden";
            case 500 -> "500 Internal Error";
            default -> "404 Not Found";
        };
    }
}
