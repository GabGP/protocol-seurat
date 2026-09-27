package seurat.net.ws;

import java.io.InputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import seurat.kit.TestKit;

/** Shutdown close: a WS close frame precedes the TCP close. */
public final class WsCloseTest {
    public static void main(String[] args) throws Exception {
        try (ServerSocket acceptor = new ServerSocket(0);
                Socket client = new Socket("127.0.0.1", acceptor.getLocalPort());
                Socket server = acceptor.accept()) {
            client.setSoTimeout(5_000);
            BlockingQueue<byte[]> control = new LinkedBlockingQueue<>();
            WsMapping mapping = new WsMapping(server, control);
            mapping.close();
            InputStream in = client.getInputStream();
            int b0 = in.read();
            int b1 = in.read();
            TestKit.check(b0 == (0x80 | WsFraming.CLOSE), "fin+close opcode");
            TestKit.check(b1 == 0, "empty close payload");
            TestKit.check(in.read() == -1, "socket closed after the frame");
        }
        System.out.println("WsCloseTest OK");
    }
}
