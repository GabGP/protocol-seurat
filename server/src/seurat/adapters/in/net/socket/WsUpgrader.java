package seurat.adapters.in.net.socket;

import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import seurat.adapters.in.net.ws.WsHandshake;
import seurat.adapters.in.net.ws.WsMapping;
import seurat.core.shared.config.SeuratConfig;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import static seurat.adapters.in.net.http.HttpConstants.CRLF;

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
        socket.setTcpNoDelay(true); // each WS message is one flushed write: never hold it for Nagle
        String accept = WsHandshake.acceptKey(headers.get("sec-websocket-key"));
        out.write(("HTTP/1.1 101 Switching Protocols" + CRLF + "Upgrade: websocket" + CRLF + "Connection: Upgrade" + CRLF
                + "Sec-WebSocket-Accept: " + accept + CRLF + "Sec-WebSocket-Protocol: " + WsHandshake.SUBPROTOCOL
                + CRLF + CRLF).getBytes(StandardCharsets.UTF_8));
        out.flush();
        BlockingQueue<byte[]> control = new ArrayBlockingQueue<>(SeuratConstants.INPUT_QUEUE_FRAMES);
        Log.info(LogTags.WS, "remote=" + remote + " upgraded subprotocol=" + WsHandshake.SUBPROTOCOL);
        acceptor.accept(new WsMapping(socket, control), control);
    }
}
