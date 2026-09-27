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
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import seurat.net.http.HttpSurface;
import seurat.net.ws.WsHandshake;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;

/**
 * One TCP port: plain HTTP routes plus the seurat.1 WebSocket mapping.
 * No state is created before a valid SALUDO.
 */
public final class SocketServer implements Closeable {
    private final int port;
    private final HttpSurface http;
    private final WsAcceptor acceptor;
    private volatile ServerSocket bound;
    private volatile boolean closed;

    public interface WsAcceptor {
        void accept(WsMapping mapping, BlockingQueue<byte[]> control);
    }

    public SocketServer(int port, HttpSurface http, WsAcceptor acceptor) {
        this.port = port;
        this.http = http;
        this.acceptor = acceptor;
    }

    public void start() throws Exception {
        try (ServerSocket server = new ServerSocket(port)) {
            bound = server;
            Log.info("net", "SocketServer listening on TCP port " + port);
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
        OutputStream out = socket.getOutputStream();
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
                headers.put(line.substring(0, colon).trim().toLowerCase(),
                        line.substring(colon + 1).trim());
            }
        }
        if (WsHandshake.isUpgrade(parts, headers)) {
            Log.info("ws", "Upgrading WebSocket connection for " + remote + " [" + parts[1] + "]");
            upgrade(socket, headers.get("sec-websocket-key"));
            Log.info("ws", "WebSocket connection upgraded (seurat.1) for " + remote);
            return;
        }
        int length = 0;
        try {
            length = Integer.parseInt(headers.getOrDefault("content-length", "0"));
        } catch (NumberFormatException ex) {
            length = 0;
        }
        byte[] body = in.readNBytes(length);
        String host = headers.getOrDefault("host", "localhost:" + port);
        long t0 = System.nanoTime();
        var response = http.route(new HttpSurface.Request(parts[0], parts[1], headers,
                body, host));
        long elapsedMs = (System.nanoTime() - t0) / 1_000_000L;
        Log.info("http", parts[0] + " " + parts[1] + " -> " + response.code()
                + " (" + elapsedMs + "ms, " + response.body().length + " B) [" + remote + "]");
        String status = statusLine(response.code());
        String header = "HTTP/1.1 " + status + "\r\nContent-Type: " + response.type()
                + "\r\nContent-Length: " + response.body().length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(response.body());
        out.flush();
        socket.close();
    }

    private static String statusLine(int code) {
        return switch (code) {
            case 200 -> "200 OK";
            case 201 -> "201 Created";
            case 202 -> "202 Accepted";
            case 403 -> "403 Forbidden";
            case 500 -> "500 Internal Error";
            default -> "404 Not Found";
        };
    }

    private void upgrade(Socket socket, String key) throws Exception {
        String accept = WsHandshake.acceptKey(key);
        String response = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                + "Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept
                + "\r\nSec-WebSocket-Protocol: seurat.1\r\n\r\n";
        socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
        socket.getOutputStream().flush();
        BlockingQueue<byte[]> control = new LinkedBlockingQueue<>();
        acceptor.accept(new WsMapping(socket, control), control);
    }
}
