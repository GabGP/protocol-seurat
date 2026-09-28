package seurat.net;

import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.Catalog;
import seurat.kit.TestKit;
import seurat.net.ws.WsFraming;
import seurat.proto.Frame;
import seurat.proto.FrameType;

/** WS guards: foreign or no Origin / no seurat.1 refused (9.2, 3.5); malformed frame fatal (8). */
public final class WsGuardsTest {
    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("ws-guards");
        int port = WsClient.serve(root, new Catalog(root.resolve("obras")));
        refusedUpgrade(port, "Origin: http://evil.example" + WsClient.CRLF + "Sec-WebSocket-Protocol: seurat.1" + WsClient.CRLF);
        refusedUpgrade(port, "Sec-WebSocket-Protocol: seurat.1" + WsClient.CRLF);
        refusedUpgrade(port, "Origin: http://x" + WsClient.CRLF);
        malformedIsFatal(port);
        System.out.println("WsGuardsTest OK");
    }

    /** CSWSH (spec 9.2) and the major version (3.5): a foreign or absent Origin, or no seurat.1, is refused. */
    static void refusedUpgrade(int port, String extra) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(5000);
            TestKit.check(WsClient.wsHandshake(socket, extra).contains("403"), "upgrade refused: " + extra);
        }
    }

    /** Spec 8: an invalid C->S frame is fatal ERROR 1, then a WebSocket close 1002. */
    static void malformedIsFatal(int port) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(5000);
            String token = WsClient.postSession(port);
            WsClient.wsHandshake(socket, "Origin: http://x" + WsClient.CRLF + "Sec-WebSocket-Protocol: seurat.1" + WsClient.CRLF);
            WsClient.sendWs(socket.getOutputStream(), 0, WsClient.hello(token));
            WsClient.readControl(socket.getInputStream());
            WsClient.sendWs(socket.getOutputStream(), 0, WsClient.frame(FrameType.RECIBO, new byte[]{1, 0x41}));
            Frame err = WsClient.readControl(socket.getInputStream());
            var pe = seurat.proto.MsgError.ProtocolError.parse(err.payload());
            TestKit.check(err.type() == FrameType.ERROR && pe.code() == 1 && pe.fail() == 1, "ERROR 1 fatal");
            WsFraming.Msg close = WsFraming.read(socket.getInputStream(), Integer.MAX_VALUE);
            TestKit.check(close.opcode() == WsFraming.CLOSE && ((close.data()[0] & 0xFF) << 8
                    | (close.data()[1] & 0xFF)) == 1002, "close 1002");
        }
    }

}
