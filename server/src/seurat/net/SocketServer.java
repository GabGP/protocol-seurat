package seurat.net;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import seurat.config.SeuratConfig;
import seurat.config.SeuratConstants;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsHandshake;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;

/**
 * One TCP port: HTTP routes plus the seurat.1 WebSocket mapping (TLS when a keystore
 * is configured). No state is created before a valid SALUDO.
 */
public final class SocketServer implements Closeable {
    private final SeuratConfig config;
    private final HttpSurface http;
    private final WsAcceptor acceptor;
    private volatile ServerSocket bound;
    private volatile boolean closed;

    public interface WsAcceptor {
        void accept(WsMapping mapping, BlockingQueue<byte[]> control);
    }

    public SocketServer(SeuratConfig config, HttpSurface http, WsAcceptor acceptor) {
        this.config = config;
        this.http = http;
        this.acceptor = acceptor;
    }

    public void start() throws Exception {
        try (ServerSocket server = Listeners.open(config)) {
            bound = server;
            Log.info("net", "Listening on TCP port " + config.httpPort + (config.tls() ? " (TLS)" : ""));
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
                        Log.debug("net", "Connection closed/error from " + remote + ": " + ex.getMessage());
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
        String head = SocketIo.readLine(in);
        if (head == null) {
            socket.close();
            return;
        }
        String[] parts = head.split(" ", 3);
        Map<String, String> headers = new HashMap<>();
        String line;
        while ((line = SocketIo.readLine(in)) != null && !line.isEmpty()) {
            int colon = line.indexOf(':');
            if (colon > 0) {
                headers.put(line.substring(0, colon).trim().toLowerCase(), line.substring(colon + 1).trim());
            }
        }
        if (WsHandshake.isUpgrade(parts, headers)) {
            upgrade(socket, headers, remote);
            return;
        }
        long length = contentLength(headers);
        String host = headers.getOrDefault("host", "localhost:" + config.httpPort);
        boolean streamed = HttpSurface.streamed(parts[0], parts[1]);
        var request = new HttpSurface.Request(parts[0], parts[1], headers,
                streamed ? new byte[0] : in.readNBytes((int) Math.min(length, SeuratConstants.FRAME_MAX)),
                host, streamed ? in : null, length);
        long t0 = System.nanoTime();
        var response = http.route(request);
        Log.info("http", parts[0] + " " + parts[1] + " -> " + response.code() + " ("
                + (System.nanoTime() - t0) / 1_000_000L + "ms) [" + remote + "]");
        StringBuilder header = new StringBuilder("HTTP/1.1 " + Listeners.status(response.code())
                + "\r\nContent-Type: " + response.type() + "\r\nContent-Length: " + response.body().length
                + "\r\nConnection: close\r\n");
        if (!response.headers().containsKey(HttpSurface.CACHE_CONTROL)) header.append("Cache-Control: no-store\r\n");
        response.headers().forEach((k, v) -> header.append(k).append(": ").append(v).append("\r\n"));
        OutputStream out = socket.getOutputStream();
        out.write(header.append("\r\n").toString().getBytes(StandardCharsets.UTF_8));
        out.write(response.body());
        out.flush();
        socket.close();
    }

    private static long contentLength(Map<String, String> headers) {
        try {
            return Math.max(0, Long.parseLong(headers.getOrDefault("content-length", "0")));
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private void upgrade(Socket socket, Map<String, String> headers, String remote) throws Exception {
        OutputStream out = socket.getOutputStream();
        if (!WsHandshake.offersSubprotocol(headers) || !WsHandshake.originAllowed(headers, config.origins)) {
            Log.warn("ws", "Upgrade refused for " + remote + " (subprotocol or Origin)");
            out.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .getBytes(StandardCharsets.UTF_8));
            socket.close();
            return;
        }
        String accept = WsHandshake.acceptKey(headers.get("sec-websocket-key"));
        out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\nSec-WebSocket-Protocol: " + WsHandshake.SUBPROTOCOL
                + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        BlockingQueue<byte[]> control = new ArrayBlockingQueue<>(SeuratConstants.INPUT_QUEUE_FRAMES);
        Log.info("ws", "WebSocket connection upgraded (seurat.1) for " + remote);
        acceptor.accept(new WsMapping(socket, control), control);
    }
}
