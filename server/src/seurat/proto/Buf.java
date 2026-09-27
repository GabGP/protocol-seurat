package seurat.proto;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** Little helpers over big-endian buffers. Single place for u8/u32/u64/str. */
public final class Buf {
    private Buf() {}

    public static void u8(ByteBuffer b, int v) {
        b.put((byte) v);
    }

    public static void u32(ByteBuffer b, long v) {
        b.putInt((int) v);
    }

    public static void u64(ByteBuffer b, long v) {
        b.putLong(v);
    }

    public static void viStr(ByteBuffer b, String stratum) {
        byte[] raw = stratum.getBytes(StandardCharsets.UTF_8);
        VarInt.put(b, raw.length);
        b.put(raw);
    }

    public static int u8(ByteBuffer b) {
        return Byte.toUnsignedInt(b.get());
    }

    public static long u32(ByteBuffer b) {
        return Integer.toUnsignedLong(b.getInt());
    }

    public static String viStr(ByteBuffer b) {
        return new String(bytes(b, VarInt.get(b)), StandardCharsets.UTF_8);
    }

    /** n bytes, checked against what is left before allocating (a length is peer data). */
    public static byte[] bytes(ByteBuffer b, long n) {
        if (n < 0 || n > b.remaining()) {
            throw new IllegalArgumentException("length " + n + " past the payload");
        }
        byte[] raw = new byte[(int) n];
        b.get(raw);
        return raw;
    }

    /** TLV extension tail: every entry must be whole; the caller skips tags it does not know. */
    public static List<Tlv> tail(ByteBuffer b) {
        List<Tlv> out = new ArrayList<>();
        while (b.hasRemaining()) {
            long tag = VarInt.get(b);
            out.add(new Tlv(tag, bytes(b, VarInt.get(b))));
        }
        return List.copyOf(out);
    }
}
