package seurat.core.shared.proto;

import java.nio.ByteBuffer;

/** QUIC varint (RFC 9000 §16). Minimal encode; any length accepted. */
public final class VarInt {
    private VarInt() {}

    public static int encodedLength(long v) {
        if (v < 0 || v >= (1L << 62)) {
            throw new IllegalArgumentException("varint range: " + v);
        }
        if (v < 64) {
            return 1;
        }
        if (v < 16384) {
            return 2;
        }
        if (v < 1073741824) {
            return 4;
        }
        return 8;
    }

    public static byte[] encode(long v) {
        ByteBuffer b = ByteBuffer.allocate(encodedLength(v));
        put(b, v);
        return b.array();
    }

    public static void put(ByteBuffer b, long v) {
        int n = encodedLength(v);
        if (n == 1) {
            b.put((byte) v);
        } else if (n == 2) {
            b.put((byte) (0x40 | (v >>> 8)));
            b.put((byte) v);
        } else if (n == 4) {
            b.put((byte) (0x80 | (v >>> 24)));
            b.put((byte) (v >>> 16));
            b.put((byte) (v >>> 8));
            b.put((byte) v);
        } else {
            b.put((byte) (0xC0 | (v >>> 56)));
            b.put((byte) (v >>> 48));
            b.put((byte) (v >>> 40));
            b.put((byte) (v >>> 32));
            b.put((byte) (v >>> 24));
            b.put((byte) (v >>> 16));
            b.put((byte) (v >>> 8));
            b.put((byte) v);
        }
    }

    public static long get(ByteBuffer b) {
        int first = Byte.toUnsignedInt(b.get());
        int n = 1 << (first >>> 6);
        long v = first & 0x3F;
        for (int i = 1; i < n; i++) {
            v = (v << 8) | Byte.toUnsignedInt(b.get());
        }
        return v;
    }
}
