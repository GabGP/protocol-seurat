package seurat.net;

import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import seurat.config.SeuratConfig;
import seurat.config.SeuratConstants;
import seurat.net.ws.WsHandshake;
import seurat.net.ws.WsMapping;
import seurat.observe.Log;
import seurat.observe.LogTags;

/** Answers a seurat.1 WebSocket upgrade (subprotocol and Origin checked) and hands the mapping to the acceptor. */
final class WsUpgrader {
    private final SeuratConfig config;
    private final SocketServer.WsAcceptor acceptor;

    WsUpgrader(SeuratConfig config, SocketServer.WsAcceptor acceptor) {
        this.config = config;
        this.acceptor = acceptor;
    }

    void upgrade(Socket socket, Map<String, String> headers, String remote) throws Exception {
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
