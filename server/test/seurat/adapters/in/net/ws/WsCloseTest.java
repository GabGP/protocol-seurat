package seurat.adapters.in.net.ws;

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
            TestKit.check(b1 == 2, "close carries a status code");
            TestKit.check(((in.read() << 8) | in.read()) == WsFraming.NORMAL, "1000 normal closure");
            TestKit.check(in.read() == -1, "socket closed after the frame");
        }
        System.out.println("WsCloseTest OK");
    }
}
