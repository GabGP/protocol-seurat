package seurat.adapters.in.net.socket;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import seurat.adapters.in.net.http.HttpSurface;
import seurat.adapters.in.net.ws.WsHandshake;
import seurat.adapters.in.net.ws.WsMapping;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;

/**
 * One TCP port: HTTP routes plus the seurat.1 WebSocket mapping (TLS when a keystore
 * is configured). No state is created before a valid SALUDO.
 */
public final class SocketServer implements Closeable {
    private final SeuratConfig config;
    private final HttpSurface http;
    private final WsUpgrader upgrader;
    private volatile ServerSocket bound;
    private volatile boolean closed;

    public interface WsAcceptor {
        void accept(WsMapping mapping, BlockingQueue<byte[]> control);
    }

    public SocketServer(SeuratConfig config, HttpSurface http, WsAcceptor acceptor) {
        this.config = config;
        this.http = http;
        this.upgrader = new WsUpgrader(config, acceptor);
    }

    public void start() throws Exception {
        try (ServerSocket server = Listeners.open(config)) {
            bound = server;
            Log.info(LogTags.NET, "listening port=" + config.httpPort + " tls=" + config.tls());
            while (!closed) {
                Socket socket;
                try {
                    socket = server.accept();
                } catch (java.net.SocketException ex) {
                    if (closed) break;
                    throw ex;
                }
                Thread.ofVirtual().start(() -> {
                    String remote = String.valueOf(socket.getRemoteSocketAddress());
                    try {
                        handle(socket, remote);
                    } catch (Throwable ex) {
                        Log.debug(LogTags.NET, "remote=" + remote + " connection ended: " + LogUnits.cause(ex));
                        try {
                            socket.close();
                        } catch (Throwable alsoIgnored) {
                        }
                    }
                });
            }
        } finally {
            bound = null;
        }
    }

    @Override
    public void close() throws IOException {
        closed = true;
        if (bound != null) bound.close();
    }

    private void handle(Socket socket, String remote) throws Exception {
        InputStream in = socket.getInputStream();
        HttpRequestReader head = HttpRequestReader.read(in);
        if (head == null) {
            socket.close();
            return;
        }
        if (!head.valid()) {
            Log.warn(LogTags.HTTP, "remote=" + remote + " bad request line: " + head.line());
            Listeners.refuse(socket, 400);
            return;
        }
        String[] parts = head.parts();
        Map<String, String> headers = head.headers();
        if (WsHandshake.isUpgrade(parts, headers)) {
            upgrader.upgrade(socket, headers, remote);
            return;
        }
        long length = head.contentLength();
        String host = headers.getOrDefault("host", "localhost:" + config.httpPort);
        boolean streamed = HttpSurface.streamed(parts[0], parts[1]);
        boolean local = socket.getInetAddress().isLoopbackAddress()
                || socket.getInetAddress().equals(socket.getLocalAddress());
        var request = new HttpSurface.Request(parts[0], parts[1], headers,
                streamed ? new byte[0] : in.readNBytes((int) Math.min(length, SeuratConstants.FRAME_MAX)),
                host, streamed ? in : null, length, local);
        long t0 = System.nanoTime();
        var response = http.route(request);
        Log.info(LogTags.HTTP, "remote=" + remote + " " + parts[0] + " " + parts[1] + " code=" + response.code()
                + " took=" + LogUnits.duration((System.nanoTime() - t0) / Units.NANOS_PER_MS));
        Listeners.respond(socket, response);
    }
}
