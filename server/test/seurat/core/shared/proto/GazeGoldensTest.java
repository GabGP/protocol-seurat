package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.kit.TestKit;

/** §3.4.2 goldens: MIRADA, CONCESION e2, PLAN INICIO, PINCELADA e64, RECIBO. */
public final class GazeGoldensTest {
    public static void main(String[] args) {
        gazeDatagram();
        gazeControl();
        concession();
        planStart();
        brushHead();
        receipt();
        System.out.println("GazeGoldensTest OK");
    }

    private static void gazeDatagram() {
        var gaze = new MsgGaze.Gaze(1, 8, 65536, 49152, 69376, 51312, 1920, 1080, 0);
        byte[] payload = gaze.encode();
        TestKit.check(payload.length == 23, "MIRADA 23B payload, got " + payload.length);
        byte[] datagram = new byte[payload.length + 1];
        datagram[0] = 0x20;
        System.arraycopy(payload, 0, datagram, 1, payload.length);
        TestKit.check(datagram.length == 24, "MIRADA datagram 24B");
        byte[] expect = TestKit.unhex("200108800100008000c00080010f008000c8704780443800");
        TestKit.check(java.util.Arrays.equals(datagram, expect), "MIRADA bytes:\n"
                + TestKit.hex(datagram));
        var back = MsgGaze.Gaze.parse(payload);
        TestKit.check(back.x0() == 65536 && back.y1() == 51312 && back.vw() == 1920
                && back.vh() == 1080 && back.seq() == 8, "MIRADA fields");
    }

    private static void gazeControl() {
        var gaze = new MsgGaze.Gaze(1, 9, 65536, 49152, 69376, 51312, 1920, 1080, 2);
        byte[] frame = new Frame(FrameType.MIRADA, gaze.encode()).encode();
        TestKit.check(frame[0] == 0x20 && frame[1] == 0x17, "MIRADA head 20 17");
        TestKit.check(frame[frame.length - 1] == 0x02, "QUIETA flag");
    }

    private static void concession() {
        var concessionMsg = new MsgGaze.ConcessionMessage(1, 2, 0, 1, 768, 36864, 120);
        byte[] frame = new Frame(FrameType.CONCESION, concessionMsg.encode()).encode();
        byte[] expect = TestKit.unhex("210c010200014300800090004078");
        TestKit.check(java.util.Arrays.equals(frame, expect), "CONCESION e2:\n"
                + TestKit.hex(frame));
    }

    private static void planStart() {
        var plan = MsgGaze.Plan.start(1, 8, 45, 212, 0);
        byte[] frame = new Frame(FrameType.PLAN, plan.encode()).encode();
        byte[] expect = TestKit.unhex("23070108002d40d400");
        TestKit.check(java.util.Arrays.equals(frame, expect), "PLAN INICIO:\n"
                + TestKit.hex(frame));
    }

    private static void brushHead() {
        var head = new Headers.BrushHead(1, 64, 0x010000000000680DL, 0, 2, 2, 4, 6,
                2, new long[]{0x647CBE67L, 0x07629C02L}, new long[]{6496, 5873});
        byte[] bytes = head.encode();
        byte[] expectHead = TestKit.unhex("01014040010000000000680d0202040602647cbe6707629c02596056f1");
        TestKit.check(java.util.Arrays.equals(bytes, expectHead), "PINCELADA e64:\n"
                + TestKit.hex(bytes));
        var back = Headers.BrushHead.parse(ByteBuffer.wrap(bytes));
        TestKit.check(back.delivery() == 64 && back.brushId() == 0x010000000000680DL
                && back.from() == 0 && back.through() == 2 && back.qy() == 4
                && back.qc() == 6 && back.edition() == 2, "PINCELADA fields");
        TestKit.check(back.lengths()[0] == 6496 && back.lengths()[1] == 5873,
                "PINCELADA lengths");
    }

    private static void receipt() {
        var ranges = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("2d01060007")));
        var receiptMsg = new MsgLoans.Receipt(1, ranges, 40, 708, 0);
        byte[] frame = new Frame(FrameType.RECIBO, receiptMsg.encode()).encode();
        byte[] expect = TestKit.unhex("260a012d010600072842c400");
        TestKit.check(java.util.Arrays.equals(frame, expect), "RECIBO:\n"
                + TestKit.hex(frame));
    }
}
