package seurat.net.ws;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** RFC 6455 server-side framing: binary only, masked reads, ping/pong. */
public final class WsFraming {
    private WsFraming() {}

    /** Close frame opcode, sent before the TCP close on shutdown. */
    public static final int CLOSE = 0x8;

    public record Msg(int opcode, byte[] data, boolean done) {}

    public static Msg read(InputStream in) throws IOException {
        int b0 = in.read();
        int b1 = in.read();
        if (b0 < 0 || b1 < 0) {
            throw new EOFException("ws closed");
        }
        boolean done = (b0 & 0x80) != 0;
        int op = b0 & 0xF;
        boolean mask = (b1 & 0x80) != 0;
        long len = b1 & 0x7F;
        if (len == 126) {
            len = ((long) in.read() << 8) | in.read();
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++) {
                len = (len << 8) | in.read();
            }
        }
        byte[] key = new byte[4];
        if (mask) {
            readFull(in, key);
        }
        byte[] data = new byte[(int) len];
        readFull(in, data);
        if (mask) {
            for (int i = 0; i < data.length; i++) {
                data[i] ^= key[i % 4];
            }
        }
        return new Msg(op, data, done);
    }

    private static void readFull(InputStream in, byte[] b) throws IOException {
        int off = 0;
        while (off < b.length) {
            int k = in.read(b, off, b.length - off);
            if (k < 0) {
                throw new EOFException("ws truncado");
            }
            off += k;
        }
    }

    public static void write(OutputStream out, int opcode, byte[] data)
            throws IOException {
        out.write(0x80 | opcode);
        if (data.length < 126) {
            out.write(opcode == 0x8 ? data.length : data.length);
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
        out.write(data);
        out.flush();
    }
}
