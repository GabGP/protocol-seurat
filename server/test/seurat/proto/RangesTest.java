package seurat.proto;

import java.nio.ByteBuffer;
import seurat.kit.TestKit;
import seurat.proto.msg.MsgLoans;

/** SACK ranges: §3.4.2 RECIBO, §3.4.3 RASPADO, §3.4.4 RENOVAR vectors. */
public final class RangesTest {
    public static void main(String[] args) {
        empty();
        emptyReceipt();
        malformedReceipt();
        malformedRanges();
        receipt();
        scraped();
        renew();
        equality();
        System.out.println("RangesTest OK");
    }

    private static void empty() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(new byte[]{0x00, 0x00, 0x00}));
        TestKit.check(r.isEmpty() && r.largest() == 0, "largest 0 is empty");
        TestKit.check(java.util.Arrays.equals(Ranges.empty().encode(),
                new byte[]{0, 0, 0}), "empty encodes 3B");
    }

    private static void receipt() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("3c01070006")));
        TestKit.check(r.contains(45) && r.contains(51) && r.contains(53)
                && r.contains(60), "receipt members");
        TestKit.check(!r.contains(52) && !r.contains(44) && !r.contains(61),
                "receipt gaps");
        TestKit.check(r.largest() == 60 && r.size() == 15, "receipt size 7+8=15");
        TestKit.check(Ranges.decode(ByteBuffer.wrap(r.encode())).equals(r), "round-trip");
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

    /** Numbers start at 1 and a Rangos cannot name more than RANGES_MAX_NUMBERS: both are malformed. */
    private static void malformedRanges() {
        for (String hex : new String[]{"050005", "8020000000801fffff"}) {
            try {
                Ranges.decode(ByteBuffer.wrap(TestKit.unhex(hex)));
                throw new AssertionError("accepted " + hex);
            } catch (IllegalArgumentException expected) {
                // below 1, or a range far past any book
            }
        }
    }

    private static void scraped() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("41000040ff")));
        TestKit.check(r.size() == 256 && r.contains(1) && r.contains(256)
                && !r.contains(257), "[1,256]");
    }

    private static void renew() {
        Ranges r = Ranges.decode(ByteBuffer.wrap(TestKit.unhex("4150012e2040ff")));
        TestKit.check(r.contains(1) && r.contains(256) && r.contains(290)
                && r.contains(336), "renew members");
        TestKit.check(!r.contains(257) && !r.contains(289), "renew gaps");
        TestKit.check(r.size() == 256 + 47, "renew size 303");
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
}
