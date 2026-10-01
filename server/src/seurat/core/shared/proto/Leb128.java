package seurat.core.shared.proto;

import java.nio.ByteBuffer;

/** QUIC-style LEB128-free zone: zigzag + unsigned LEB128 for band values. */
public final class Leb128 {
    private Leb128() {}

    public static int zigzagEncode(int n) {
        return (n << 1) ^ (n >> 31);
    }

    public static int zigzagDecode(int n) {
        return (n >>> 1) ^ -(n & 1);
    }

    public static void putU(ByteBuffer b, int v) {
        while ((v & ~0x7F) != 0) {
            b.put((byte) ((v & 0x7F) | 0x80));
            v >>>= 7;
        }
        b.put((byte) v);
    }

    /** Writes v as unsigned LEB128 at raw[pos]; returns the position after it. */
    public static int putU(byte[] raw, int pos, int v) {
        while ((v & ~0x7F) != 0) {
            raw[pos++] = (byte) ((v & 0x7F) | 0x80);
            v >>>= 7;
        }
        raw[pos++] = (byte) v;
        return pos;
    }

    public static int getU(ByteBuffer b) {
        int v = 0;
        int shift = 0;
        while (true) {
            int by = Byte.toUnsignedInt(b.get());
            v |= (by & 0x7F) << shift;
            if ((by & 0x80) == 0) {
                return v;
            }
            shift += 7;
        }
    }
}
