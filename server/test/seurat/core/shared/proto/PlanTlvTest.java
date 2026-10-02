package seurat.core.shared.proto;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.kit.TestKit;

/** PLAN INICIO TLV 0x04 IRRECUPERABLES codec round trips and wire golden (ADR-06). */
public final class PlanTlvTest {
    public static void main(String[] args) {
        emptyIdsMatchesFiveArgStart();
        twoIdsRoundTrip();
        unknownTlvSkipped();
        exactBytesOneIdMatchesClient();
        System.out.println("PlanTlvTest OK");
    }

    private static void emptyIdsMatchesFiveArgStart() {
        MsgGaze.Plan p5 = MsgGaze.Plan.start(1, 2, 3, 4, 0);
        MsgGaze.Plan pEmpty = MsgGaze.Plan.start(1, 2, 3, 4, 0, List.of());
        byte[] b5 = p5.encode();
        byte[] bEmpty = pEmpty.encode();
        TestKit.check(Arrays.equals(b5, bEmpty), "empty ids encode matches 5-arg start");
        MsgGaze.Plan back = MsgGaze.Plan.parse(b5);
        TestKit.check(back.unrecoverable().isEmpty(), "parsed empty unrecoverable list");
    }

    private static void twoIdsRoundTrip() {
        BrushId id1 = new BrushId(0, 1, 1);
        BrushId id2 = new BrushId(2, 3, 4);
        MsgGaze.Plan plan = MsgGaze.Plan.start(10, 20, 30, 40, 1, List.of(id1.id(), id2.id()));
        byte[] enc = plan.encode();
        MsgGaze.Plan back = MsgGaze.Plan.parse(enc);
        TestKit.check(back.handle() == 10, "handle");
        TestKit.check(back.gazeSeq() == 20, "gazeSeq");
        TestKit.check(back.first() == 30, "first");
        TestKit.check(back.expectedCount() == 40, "expectedCount");
        TestKit.check(back.throttle() == 1, "throttle");
        TestKit.check(back.unrecoverable().equals(List.of(id1.id(), id2.id())), "round-trip 2 ids");
    }

    private static void unknownTlvSkipped() {
        BrushId id1 = new BrushId(1, 2, 3);
        MsgGaze.Plan plan = MsgGaze.Plan.start(5, 6, 7, 8, 0, List.of(id1.id()));
        byte[] enc = plan.encode();
        byte[] unknown = new Tlv(0x99, new byte[]{1, 2, 3, 4}).encode();
        ByteBuffer combined = ByteBuffer.allocate(enc.length + unknown.length);
        combined.put(enc).put(unknown);
        MsgGaze.Plan back = MsgGaze.Plan.parse(combined.array());
        TestKit.check(back.unrecoverable().equals(List.of(id1.id())), "unknown tag skipped");
    }

    private static void exactBytesOneIdMatchesClient() {
        BrushId brush = new BrushId(0, 1, 1);
        MsgGaze.Plan plan = MsgGaze.Plan.start(1, 2, 3, 4, 0, List.of(brush.id()));
        byte[] payload = plan.encode();
        int tail = payload.length - 11;
        TestKit.check(payload[tail] == 0x04, "tag 0x04");
        TestKit.check(payload[tail + 1] == 0x09, "length 0x09");
        TestKit.check(payload[tail + 2] == 0x01, "n 0x01");
        ByteBuffer b = ByteBuffer.wrap(payload, tail + 3, 8);
        TestKit.check(b.getLong() == brush.id(), "brush id big-endian u64");
        MsgGaze.Plan back = MsgGaze.Plan.parse(payload);
        TestKit.check(back.unrecoverable().equals(List.of(brush.id())), "exact bytes parse back");
    }
}
