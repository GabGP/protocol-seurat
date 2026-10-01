package seurat.adapters.in.net.ws;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import seurat.kit.TestKit;

/** WS writer: frame bytes identical to the old byte-at-a-time writer, one socket write and one flush per message. */
public final class WsFramingWriteTest {
    private static final int SMALL = 5;
    private static final int EXT_16 = 200;
    private static final int EXT_64 = 70_000;

    public static void main(String[] args) throws Exception {
        headerGoldens();
        sameBytesAsBefore();
        oneWriteOneFlushPerMessage();
        System.out.println("WsFramingWriteTest OK");
    }

    private static void headerGoldens() {
        check(WsFraming.header(WsFraming.BINARY, SMALL), 0x82, 0x05);
        check(WsFraming.header(WsFraming.BINARY, 125), 0x82, 0x7D);
        check(WsFraming.header(WsFraming.BINARY, 126), 0x82, 0x7E, 0x00, 0x7E);
        check(WsFraming.header(WsFraming.BINARY, EXT_16), 0x82, 0x7E, 0x00, 0xC8);
        check(WsFraming.header(WsFraming.BINARY, 65_535), 0x82, 0x7E, 0xFF, 0xFF);
        check(WsFraming.header(WsFraming.BINARY, 65_536), 0x82, 0x7F, 0, 0, 0, 0, 0, 0x01, 0x00, 0x00);
        check(WsFraming.header(WsFraming.BINARY, EXT_64), 0x82, 0x7F, 0, 0, 0, 0, 0, 0x01, 0x11, 0x70);
        check(WsFraming.header(WsFraming.CLOSE, 2), 0x88, 0x02);
    }

    private static void check(byte[] got, int... want) {
        byte[] w = new byte[want.length];
        for (int i = 0; i < want.length; i++) {
            w[i] = (byte) want[i];
        }
        TestKit.check(Arrays.equals(got, w), "header golden " + Arrays.toString(w) + " got " + Arrays.toString(got));
    }

    private static void sameBytesAsBefore() throws IOException {
        for (int len : new int[]{0, 1, SMALL, 125, 126, EXT_16, 65_535, 65_536, EXT_64}) {
            byte[] data = payload(len);
            ByteArrayOutputStream now = new ByteArrayOutputStream();
            WsFraming.write(now, WsFraming.BINARY, data);
            TestKit.check(Arrays.equals(now.toByteArray(), legacy(WsFraming.BINARY, data)), "same frame bytes, len " + len);
        }
    }

    private static void oneWriteOneFlushPerMessage() throws Exception {
        Counting sink = new Counting();
        WsOutbound outbound = new WsOutbound(sink);
        var first = outbound.delivery(1, payload(EXT_16));
        var second = outbound.delivery(2, payload(EXT_64));
        outbound.control(WsFraming.BINARY, payload(SMALL)); // queued last, written first
        Thread writer = Thread.ofVirtual().start(outbound);
        first.get(5, TimeUnit.SECONDS);
        second.get(5, TimeUnit.SECONDS);
        outbound.close(WsFraming.NORMAL);
        writer.join(TimeUnit.SECONDS.toMillis(5));
        ByteArrayOutputStream want = new ByteArrayOutputStream();
        want.write(legacy(WsFraming.BINARY, payload(SMALL)));
        want.write(legacy(WsFraming.BINARY, payload(EXT_16)));
        want.write(legacy(WsFraming.BINARY, payload(EXT_64)));
        want.write(legacy(WsFraming.CLOSE, new byte[]{(byte) (WsFraming.NORMAL >> 8), (byte) WsFraming.NORMAL}));
        TestKit.check(Arrays.equals(sink.bytes.toByteArray(), want.toByteArray()), "control first, then deliveries, then close");
        TestKit.check(sink.flushes == 4, "one flush per message: " + sink.flushes);
        TestKit.check(sink.writes == 4, "header and payload leave in one socket write: " + sink.writes);
    }

    private static byte[] payload(int len) {
        byte[] b = new byte[len];
        for (int i = 0; i < len; i++) {
            b[i] = (byte) (i * 31 + 7);
        }
        return b;
    }

    /** The pre-buffering writer, byte at a time: the reference the new one must match. */
    private static byte[] legacy(int opcode, byte[] data) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0x80 | opcode);
        if (data.length < 126) {
            out.write(data.length);
        } else if (data.length < 65536) {
            out.write(126);
            out.write(data.length >> 8);
            out.write(data.length);
        } else {
            out.write(127);
            for (int i = 7; i >= 0; i--) {
                out.write((int) ((long) data.length >> (8 * i)));
            }
        }
        out.writeBytes(data);
        return out.toByteArray();
    }

    /** A socket stand-in counting the writes and flushes that reach it. */
    private static final class Counting extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        int writes;
        int flushes;

        @Override
        public void write(int b) {
            writes++;
            bytes.write(b);
        }

        @Override
        public void write(byte[] b, int off, int len) {
            writes++;
            bytes.write(b, off, len);
        }

        @Override
        public void flush() {
            flushes++;
        }
    }
}
