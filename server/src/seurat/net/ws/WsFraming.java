package seurat.net.ws;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/** RFC 6455 server-side framing: masked reads, fragments reassembled, sizes capped before allocating. */
public final class WsFraming {
    private WsFraming() {}

    public static final int CONTINUATION = 0x0;
    public static final int BINARY = 0x2;
    public static final int CLOSE = 0x8;
    public static final int PING = 0x9;
    public static final int PONG = 0xA;
    public static final int NORMAL = 1000;
    public static final int PROTOCOL_ERROR = 1002;
    /** Pseudo-opcode for a message past the cap (a frame over 64 KiB is fatal, spec 3.2). */
    public static final int OVERSIZE = -1;

    public record Msg(int opcode, byte[] data) {}

    /** One whole message (fragments joined); past `max` bytes it is OVERSIZE, left unread. */
    public static Msg read(InputStream in, int max) throws IOException {
        ByteArrayOutputStream joined = null;
        int opcode = -1;
        for (;;) {
            int b0 = in.read();
            int b1 = in.read();
            if (b0 < 0 || b1 < 0) {
                throw new EOFException("ws closed");
            }
            boolean fin = (b0 & 0x80) != 0;
            int op = b0 & 0xF;
            long len = b1 & 0x7F;
            if (len == 126) {
                len = ((long) in.read() << 8) | in.read();
            } else if (len == 127) {
                len = 0;
                for (int i = 0; i < 8; i++) {
                    len = (len << 8) | in.read();
                }
            }
            if (len < 0 || len > max || (joined != null && joined.size() + len > max)) {
                return new Msg(OVERSIZE, new byte[0]); // never allocated: the caller fails the session
            }
            byte[] key = new byte[4];
            if ((b1 & 0x80) != 0) {
                readFull(in, key);
            }
            byte[] data = new byte[(int) len];
            readFull(in, data);
            for (int i = 0; i < data.length; i++) {
                data[i] ^= key[i % 4];
            }
            if (op >= CLOSE) {
                return new Msg(op, data); // control frames are never fragmented
            }
            if (op != CONTINUATION) {
                opcode = op;
            }
            if (fin && joined == null) {
                return new Msg(opcode, data);
            }
            if (joined == null) {
                joined = new ByteArrayOutputStream();
            }
            joined.write(data);
            if (fin) {
                return new Msg(opcode, joined.toByteArray());
            }
        }
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

    public static void write(OutputStream out, int opcode, byte[] data) throws IOException {
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
        out.write(data);
        out.flush();
    }

    /** Close frame with a status code (1000 normal, 1002 protocol error). */
    public static void close(OutputStream out, int code) throws IOException {
        write(out, CLOSE, new byte[]{(byte) (code >> 8), (byte) code});
    }
}
