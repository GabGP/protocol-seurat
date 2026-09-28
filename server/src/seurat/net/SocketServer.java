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
import seurat.config.Units;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsHandshake;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;

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
        String head = SocketIo.readLine(in);
        if (head == null) {
            socket.close();
            return;
        }
        String[] parts = head.split(" ", 3);
        if (parts.length < 2) {
            Log.warn(LogTags.HTTP, "remote=" + remote + " bad request line: " + head);
            Listeners.refuse(socket, 400);
            return;
        }
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
        Log.info(LogTags.HTTP, "remote=" + remote + " " + parts[0] + " " + parts[1] + " code=" + response.code()
                + " took=" + LogUnits.duration((System.nanoTime() - t0) / Units.NANOS_PER_MS));
        Listeners.respond(socket, response);
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
            Log.warn(LogTags.WS, "remote=" + remote + " upgrade refused: subprotocol or Origin");
            Listeners.refuse(socket, 403);
            return;
        }
        String accept = WsHandshake.acceptKey(headers.get("sec-websocket-key"));
        out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\nSec-WebSocket-Protocol: " + WsHandshake.SUBPROTOCOL
                + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.flush();
        BlockingQueue<byte[]> control = new ArrayBlockingQueue<>(SeuratConstants.INPUT_QUEUE_FRAMES);
        Log.info(LogTags.WS, "remote=" + remote + " upgraded subprotocol=" + WsHandshake.SUBPROTOCOL);
        acceptor.accept(new WsMapping(socket, control), control);
    }
}
