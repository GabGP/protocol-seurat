package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Random;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.kit.TestKit;

/** Teselas sets (ADR-09): appendix vectors, forms, limits, block storage. */
public final class TeselasTest {
    public static void main(String[] args) {
        vectors();
        decodeNonChosenForms();
        malformed();
        roundTrip();
        emptyReceipt();
        malformedReceipt();
        equality();
        blocks();
        System.out.println("TeselasTest OK");
    }

    private static void checkVector(Ranges r, String hex) {
        byte[] enc = r.encode();
        TestKit.check(Arrays.equals(enc, TestKit.unhex(hex)),
                "encode hex mismatch: got " + TestKit.hex(enc) + " want " + hex);
        Ranges dec = Ranges.decode(ByteBuffer.wrap(TestKit.unhex(hex)));
        TestKit.check(dec.equals(r), "decode round-trip mismatch for " + hex);
    }

    private static void vectors() {
        checkVector(Ranges.empty(), "0000");
        checkVector(new Ranges.Builder().addRange(45, 51).addRange(53, 60).build(), "2d01060007");
        checkVector(new Ranges.Builder().addRange(285, 289).build(), "411d0004");
        checkVector(new Ranges.Builder().addRange(1, 256).build(), "010040ff");
        checkVector(new Ranges.Builder().addRange(1, 256).addRange(290, 336).build(), "010140ff202e");

        Ranges.Builder oddB = new Ranges.Builder();
        for (int n = 1; n <= 39; n += 2) oddB.add(n);
        Ranges odd = oddB.build();
        checkVector(odd, "000101025555555555000000");

        Ranges.Builder odd70 = new Ranges.Builder();
        for (int n = 1; n <= 39; n += 2) odd70.add(n);
        odd70.addRange(70, 80);
        checkVector(odd70.build(), "00010202555555555500000007050a");

        Ranges.Builder odd1000 = new Ranges.Builder();
        for (int n = 1; n <= 39; n += 2) odd1000.add(n);
        odd1000.add(1000);
        checkVector(odd1000.build(), "00010302555555555500000038072700");

        Ranges.Builder b128 = new Ranges.Builder();
        b128.addRange(1, 128);
        for (int n = 129; n <= 167; n += 2) b128.add(n);
        checkVector(b128.build(), "00010209025555555555000000");
    }

    private static void decodeNonChosenForms() {
        Ranges r1 = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("00010111")));
        TestKit.check(r1.equals(new Ranges.Builder().addRange(1, 256).build()),
                "00010111 => [1,256]");

        Ranges r2 = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("002d010b00060807")));
        TestKit.check(r2.equals(new Ranges.Builder().addRange(45, 51).addRange(53, 60).build()),
                "002d010b00060807 => [45,51]+[53,60]");
    }

    private static void malformed() {
        for (String hex : new String[]{"000101073f01", "0001010255", "00010180013881", "2d"}) {
            try {
                Ranges.decode(ByteBuffer.wrap(TestKit.unhex(hex)));
                throw new AssertionError("malformed accepted: " + hex);
            } catch (IllegalArgumentException | java.nio.BufferUnderflowException expected) {
                // expected
            }
        }
    }

    private static void roundTrip() {
        Random rnd = new Random(9);
        for (int i = 0; i < 2000; i++) {
            Ranges.Builder b = new Ranges.Builder();
            int mode = i % 4;
            if (mode == 0) {
                long lo = rnd.nextInt(20_000_000) + 1;
                long len = rnd.nextInt(2000) + 1;
                b.addRange(lo, lo + len);
            } else if (mode == 1) {
                int count = rnd.nextInt(50) + 1;
                for (int k = 0; k < count; k++) b.add(rnd.nextInt(200) + 1);
            } else if (mode == 2) {
                long cur = rnd.nextInt(1000) + 1;
                int nRuns = rnd.nextInt(20) + 1;
                for (int k = 0; k < nRuns; k++) {
                    long len = rnd.nextInt(50);
                    b.addRange(cur, cur + len);
                    cur += len + rnd.nextInt(100) + 2;
                }
            } else {
                int count = rnd.nextInt(30) + 1;
                for (int k = 0; k < count; k++) {
                    long lo = rnd.nextInt(20_000_000) + 1;
                    if (rnd.nextBoolean()) b.add(lo);
                    else b.addRange(lo, lo + rnd.nextInt(50));
                }
            }
            Ranges s = b.build();
            byte[] enc = s.encode();
            Ranges dec = Ranges.decode(ByteBuffer.wrap(enc));
            TestKit.check(dec.equals(s), "round trip mismatch at " + i);
        }
    }

    private static void emptyReceipt() {
        var receiptMsg = new MsgLoans.Receipt(1, Ranges.empty(), 40, 708, 0);
        var parsed = MsgLoans.Receipt.parse(receiptMsg.encode());
        TestKit.check(parsed.completed().isEmpty() && parsed.queueMs() == 40
                && parsed.free() == 708 && parsed.renewThrough() == 0,
                "empty RECIBO keeps following fields");
    }

    private static void malformedReceipt() {
        try {
            Wire.parse(FrameType.RECIBO, () -> MsgLoans.Receipt.parse(new byte[]{1, 0}));
            throw new AssertionError("truncated RECIBO accepted");
        } catch (FatalProtocol ex) {
            TestKit.check(ex.code == 1 && ex.refType == FrameType.RECIBO,
                    "truncated RECIBO is fatal ERROR 1");
        }
    }

    private static void equality() {
        Ranges.Builder b = new Ranges.Builder();
        b.addRange(1, 256);
        TestKit.check(!b.build().equals(Ranges.of()), "empty != full");
        Ranges.Builder c = new Ranges.Builder();
        for (long n = 1; n <= 256; n++) {
            c.add(n);
        }
        TestKit.check(b.build().equals(c.build()), "range == pointwise");
    }

    private static void blocks() {
        Ranges.Builder b = new Ranges.Builder();
        b.addRange(60, 200);
        b.add(1000);
        Ranges r = b.build();
        TestKit.check(r.size() == 142, "size 142");
        TestKit.check(r.smallest() == 60, "smallest 60");
        TestKit.check(r.largest() == 1000, "largest 1000");
        var spans = r.spans();
        TestKit.check(spans.size() == 2
                && spans.get(0)[0] == 60 && spans.get(0)[1] == 200
                && spans.get(1)[0] == 1000 && spans.get(1)[1] == 1000,
                "spans {60,200},{1000,1000}");
        TestKit.check(r.contains(63) && r.contains(64) && r.contains(128) && !r.contains(201),
                "contains boundary checks");
        Ranges.Builder rangeB = new Ranges.Builder();
        rangeB.addRange(1, 256);
        Ranges.Builder descB = new Ranges.Builder();
        for (long n = 256; n >= 1; n--) {
            descB.add(n);
        }
        TestKit.check(rangeB.build().equals(descB.build()), "addRange(1,256) == descending add");
        try {
            new Ranges.Builder().add(0);
            throw new AssertionError("add(0) accepted");
        } catch (IllegalArgumentException expected) {
            // expected
        }
    }
}
