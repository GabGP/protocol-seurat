package seurat.core.shared.proto;

import seurat.kit.TestKit;

/** QUIC varint: RFC 9000 A.1 vectors, min-length encode, lax decode. */
public final class VarIntTest {
    public static void main(String[] args) {
        vectors();
        minLength();
        laxDecode();
        range();
        System.out.println("VarIntTest OK");
    }

    private static void vectors() {
        check("25", 37);
        check("7bbd", 15293);
        check("9d7f3e7d", 494878333L);
        check("c2197c5eff14e88c", 151288809941952652L);
    }

    private static void check(String hex, long v) {
        TestKit.check(java.util.Arrays.equals(VarInt.encode(v), TestKit.unhex(hex)),
                "encode " + v);
        TestKit.check(VarInt.get(java.nio.ByteBuffer.wrap(TestKit.unhex(hex))) == v,
                "decode " + hex);
    }

    private static void minLength() {
        TestKit.check(VarInt.encode(37).length == 1, "37 -> 1B");
        TestKit.check(VarInt.encode(15293).length == 2, "15293 -> 2B");
        TestKit.check(VarInt.encode(494878333L).length == 4, "494M -> 4B");
        TestKit.check(VarInt.encode(151288809941952652L).length == 8, "big -> 8B");
        TestKit.check(VarInt.encode(0).length == 1, "0 -> 1B");
        TestKit.check(VarInt.encode(63).length == 1, "63 -> 1B");
        TestKit.check(VarInt.encode(64).length == 2, "64 -> 2B");
    }

    private static void laxDecode() {
        TestKit.check(VarInt.get(java.nio.ByteBuffer.wrap(TestKit.unhex("4025"))) == 37,
                "4025 accepted as 37");
    }

    private static void range() {
        try {
            VarInt.encode(1L << 62);
            throw new AssertionError("expected range error");
        } catch (IllegalArgumentException expected) {
        }
    }
}
