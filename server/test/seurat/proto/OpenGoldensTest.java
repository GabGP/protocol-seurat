package seurat.proto;

import seurat.kit.TestKit;
import seurat.proto.msg.MsgCatalog;
import seurat.proto.msg.MsgGaze;

/** Spec 3.4.1 after BIENVENIDA, byte for byte: ABRIR, ABIERTA, initial CONCESION, the seed's header. */
public final class OpenGoldensTest {
    public static void main(String[] args) {
        open();
        opened();
        initialConcession();
        seedHead();
        System.out.println("OpenGoldensTest OK");
    }

    private static void open() {
        byte[] frame = new Frame(FrameType.ABRIR, new MsgCatalog.OpenWork("slide-0421").encode()).encode();
        TestKit.check(TestKit.hex(frame).equals("120b0a736c6964652d30343231"), "ABRIR: " + TestKit.hex(frame));
    }

    private static void opened() {
        var a = new MsgCatalog.WorkOpened(1, 196_608, 163_840, 11, 2, 0, 2, 192, 160);
        byte[] frame = new Frame(FrameType.ABIERTA, a.encode()).encode();
        // 13 11 · handle 1 · 196608 · 163840 · 11 strata · ed 2 · ceiling 0/2 · seed 192 x 160
        TestKit.check(TestKit.hex(frame).equals("1311" + "01" + "80030000" + "80028000" + "0b" + "02" + "0002" + "40c040a0"),
                "ABIERTA: " + TestKit.hex(frame));
    }

    private static void initialConcession() {
        var c = new MsgGaze.ConcessionMessage(1, 1, 7, 4, ProtoCodes.MOT_INICIAL, 768, 36_864, 120);
        byte[] frame = new Frame(FrameType.CONCESION, c.encode()).encode();
        TestKit.check(TestKit.hex(frame).equals("210d01010704004300800090004078"), "CONCESION: " + TestKit.hex(frame));
    }

    /** entrega 1 = the seed: id 10 << 56, bands [0,1), epoch 1, qY = qC = 1, edition 2, one CRC and length. */
    private static void seedHead() {
        var head = new Headers.BrushHead(1, 1, 10L << 56, 0, 1, 1, 1, 1, 2,
                new long[]{0x0ccdcf6dL}, new long[]{16_216});
        TestKit.check(TestKit.hex(head.encode()).equals("0101010a0000000000000001010101020ccdcf6d7f58"),
                "PINCELADA header: " + TestKit.hex(head.encode()));
    }
}
