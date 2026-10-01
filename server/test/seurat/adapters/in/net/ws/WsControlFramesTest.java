package seurat.adapters.in.net.ws;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import seurat.kit.TestKit;

/** WS control frames: over 125 B is a protocol error (RFC 6455 5.5); a PING flood keeps one PONG. */
public final class WsControlFramesTest {
    public static void main(String[] args) throws Exception {
        oversizedPing();
        pingFlood();
        System.out.println("WsControlFramesTest OK");
    }

    private static byte[] maskedPing(int len) {
        byte[] f = new byte[2 + 2 + 4 + len];
        f[0] = (byte) (0x80 | WsFraming.PING);
        f[1] = (byte) (0x80 | 126);
        f[2] = (byte) (len >> 8);
        f[3] = (byte) len;
        return f;
    }

    private static void oversizedPing() throws Exception {
        byte[] ok = new byte[2 + 4 + 125];
        ok[0] = (byte) (0x80 | WsFraming.PING);
        ok[1] = (byte) (0x80 | 125);
        WsFraming.Msg fine = WsFraming.read(new ByteArrayInputStream(ok), Integer.MAX_VALUE);
        TestKit.check(fine.opcode() == WsFraming.PING && fine.data().length == 125, "a 125 B PING is fine");
        WsFraming.Msg bad = WsFraming.read(new ByteArrayInputStream(maskedPing(126)), Integer.MAX_VALUE);
        TestKit.check(bad.opcode() == WsFraming.BAD_CONTROL, "a 126 B PING is a protocol error");
    }

    private static void pingFlood() throws Exception {
        ByteArrayOutputStream sink = new ByteArrayOutputStream();
        WsOutbound outbound = new WsOutbound(sink);
        for (int i = 0; i < 1000; i++) {
            outbound.control(WsFraming.PONG, new byte[]{(byte) i});
        }
        outbound.close(WsFraming.NORMAL);
        outbound.run();
        byte[] out = sink.toByteArray();
        TestKit.check(out.length == 2 + 1 + 4, "one PONG then the close frame: " + out.length);
        TestKit.check(out[0] == (byte) (0x80 | WsFraming.PONG) && out[2] == (byte) 999, "the newest PONG survives");
    }
}
