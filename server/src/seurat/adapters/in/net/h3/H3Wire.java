package seurat.adapters.in.net.h3;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import seurat.core.shared.proto.VarInt;

/** HTTP/3 framing on a QUIC stream (RFC 9114 §7.1): varint type, varint length, payload. */
public final class H3Wire {
    private H3Wire() {}

    /** Reads one QUIC varint (RFC 9000 §16); EOFException when the stream ends. */
    public static long readVarint(InputStream in) throws IOException {
        int first = in.read();
        if (first < 0) {
            throw new EOFException("end of stream reading varint");
        }
        int len = 1 << (first >>> 6);
        long val = first & 0x3F;
        for (int i = 1; i < len; i++) {
            int next = in.read();
            if (next < 0) {
                throw new EOFException("end of stream reading varint");
            }
            val = (val << 8) | next;
        }
        return val;
    }

    /** One frame: type, length, payload. */
    public static byte[] frame(long type, byte[] payload) {
        byte[] t = VarInt.encode(type);
        byte[] l = VarInt.encode(payload.length);
        return concat(t, l, payload);
    }

    /** The payload of a frame whose type was already read: length, then that many bytes. */
    public static byte[] readPayload(InputStream in, int max) throws IOException {
        long len = readVarint(in);
        if (len < 0 || len > max) {
            throw new IOException("frame length " + len + " exceeds max " + max);
        }
        byte[] payload = in.readNBytes((int) len);
        if (payload.length < len) {
            throw new EOFException("stream ended before reading frame payload");
        }
        return payload;
    }

    /** Concatenation helper. */
    public static byte[] concat(byte[]... parts) {
        int total = 0;
        for (byte[] p : parts) {
            total += p.length;
        }
        byte[] out = new byte[total];
        int pos = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, pos, p.length);
            pos += p.length;
        }
        return out;
    }
}
