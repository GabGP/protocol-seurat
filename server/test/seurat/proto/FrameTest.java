package seurat.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;
import seurat.kit.TestKit;
import seurat.proto.msg.MsgHello;
import seurat.proto.msg.MsgWelcome;

/** Frames: §3.4.1 SALUDO/BIENVENIDA byte-exact, skip/fatal rules, TLV. */
public final class FrameTest {
    public static void main(String[] args) {
        helloGolden();
        welcomeGolden();
        unknownOptionalSkipped();
        unknownMandatoryFatal();
        oversizeFatal();
        tlvSkip();
        System.out.println("FrameTest OK");
    }

    static byte[] token(byte fill) {
        byte[] t = new byte[32];
        Arrays.fill(t, fill);
        return t;
    }

    private static void helloGolden() {
        var hello = new MsgHello.Hello(1, 1, 3, 256, token((byte) 0xAB), null);
        byte[] payload = hello.encode();
        TestKit.check(payload.length == 38, "SALUDO payload 38, got " + payload.length);
        byte[] frame = new Frame(FrameType.SALUDO, payload).encode();
        TestKit.check(frame[0] == 0x01 && frame[1] == 0x26, "SALUDO head 01 26");
        TestKit.check(payload[0] == 0x01 && payload[1] == 0x01 && payload[2] == 0x03,
                "minVersion/caps");
        TestKit.check(payload[3] == 0x41 && payload[4] == 0x00, "mem 256");
        TestKit.check(payload[5] == 0x20, "token_len 32");
        Frame back = Frame.decode(ByteBuffer.wrap(frame));
        TestKit.check(back.type() == FrameType.SALUDO, "type round-trip");
        var parsed = MsgHello.Hello.parse(back.payload());
        TestKit.check(parsed.minVersion() == 1 && parsed.maxVersion() == 1
                && parsed.caps() == 3 && parsed.memMib() == 256
                && Arrays.equals(parsed.token(), token((byte) 0xAB)), "SALUDO fields");
    }

    private static void welcomeGolden() {
        var welcome = new MsgWelcome.Welcome(1, 3, 0x3A915E0C77D214B8L, 256,
                120, 15, 12, 1024, token((byte) 0x7A), java.util.List.of());
        byte[] payload = welcome.encode();
        TestKit.check(payload.length == 52, "BIENVENIDA payload 52, got " + payload.length);
        byte[] frame = new Frame(FrameType.BIENVENIDA, payload).encode();
        TestKit.check(frame[0] == 0x02 && frame[1] == 0x34, "BIENVENIDA head 02 34");
        TestKit.check(payload[0] == 0x01 && payload[1] == 0x03, "version/caps");
        TestKit.check(payload[10] == 0x41 && payload[11] == 0x00, "side 256");
        TestKit.check(payload[12] == 0x40 && payload[13] == 0x78, "lease 120");
        TestKit.check(payload[14] == 0x0F && payload[15] == 0x0C, "heartbeat/max");
        TestKit.check(payload[16] == 0x44 && payload[17] == 0x00, "sessionMax 1024");
        TestKit.check(payload[18] == 0x02 && payload[19] == 0x20, "FICHA tag");
    }

    private static void unknownOptionalSkipped() {
        byte[] payload = {0x01};
        Frame f = Frame.decode(ByteBuffer.wrap(new Frame(0x40, payload).encode()));
        TestKit.check(f.type() == 0x40 && f.payload().length == 1, "optional kept");
    }

    private static void unknownMandatoryFatal() {
        TestKit.check(Frame.mandatory(0x01) && !Frame.mandatory(0x40),
                "mandatory boundary 0x40");
    }

    private static void oversizeFatal() {
        byte[] big = new byte[65537];
        try {
            Frame.decode(ByteBuffer.wrap(new Frame(0x01, big).encode()));
            throw new AssertionError("expected oversize fatal");
        } catch (FatalProtocol expected) {
            TestKit.check(expected.code == 1, "ERROR 1");
        }
    }

    private static void tlvSkip() {
        var hello = new MsgHello.Hello(1, 1, 3, 256, token((byte) 1), null);
        byte[] payload = hello.encode();
        byte[] tag = new Tlv(0x77, new byte[]{9, 9}).encode();
        byte[] glued = new byte[payload.length + tag.length];
        System.arraycopy(payload, 0, glued, 0, payload.length);
        System.arraycopy(tag, 0, glued, payload.length, tag.length);
        var parsed = MsgHello.Hello.parse(glued);
        TestKit.check(parsed.memMib() == 256 && parsed.resume() == null, "TLV skipped");
    }
}
