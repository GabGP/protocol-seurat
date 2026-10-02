package seurat.core.viewing.paint;

import java.nio.ByteBuffer;
import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.Headers;
import seurat.core.shared.proto.Ranges;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.works.store.WorkMeta;
import seurat.kit.PainterRig;
import seurat.kit.TestKit;

/** Painter gates: red cola_ms (spec 6.1), valid band prefix (8). */
public final class PainterGatesTest {
    public static void main(String[] args) throws Exception {
        redHoldsNewFlows();
        amberHalvesSlots();
        corruptBandServesPrefix();
        knownBadBandsClampBeforeOpen();
        windowWaitIsNotCongestion();
        fullBookOpensUpgradeRefusesNewBrush();
        System.out.println("PainterGatesTest OK");
    }

    /**
     * Spec 6.3: dwell starts when the entry is "lista" (its turn, its session's gates open).
     * An entry parked behind its own RECIBO.libre for 400 ms opens with ~0 dwell: no CoDel mark.
     */
    private static void windowWaitIsNotCongestion() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(1));
        rig.canvas.free = 1;
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        rig.awaitDeliveries(1);
        rig.regulator.tick(List.of(rig.session)); // closes the first entry's tick
        Thread.sleep(400);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(2));
        rig.painter.unpark(rig.canvas);
        rig.awaitDeliveries(2);
        TestKit.check(rig.mapping.deliveries.size() == 2, "credit releases the parked entry");
        rig.regulator.tick(List.of(rig.session));
        TestKit.check(!rig.regulator.congested(), "waiting on its own window is not server queueing");
        thread.interrupt();
    }

    /** Spec 4.1 (c) counts brushes: a full book still opens an upgrade of a held brush and refuses a new one. */
    private static void fullBookOpensUpgradeRefusesNewBrush() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.setConcession(new Concession(1, 0, 4, 1, 2, 36864, 120));
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().log(new BrushId(1, 0, 0), 0, 2, 10, 1);
        rig.canvas.book().settle(Ranges.of(1, 2));
        rig.canvas.free = 10;
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)),
                rig.canvas.plan().start(0, 1));
        Thread.sleep(300);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "2 of 2 brushes held: a new brush waits");
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 2, 4, 1)),
                rig.canvas.plan().start(0, 1));
        rig.awaitDeliveries(1);
        TestKit.check(rig.mapping.deliveries.size() == 1, "an upgrade of a held brush needs no new slot");
        TestKit.check(rig.canvas.book().brushCount() == 2 && rig.canvas.book().size() == 3,
                "3 deliveries, still 2 brushes");
        thread.interrupt();
    }

    /** Red (> 400 ms): nothing new opens until cola_ms drops below 150 ms (hysteresis). */
    private static void redHoldsNewFlows() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(1));
        rig.session.queue(450);
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1)),
                rig.canvas.plan().start(0, 1));
        Thread.sleep(300);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "red: held");
        rig.session.queue(200);
        rig.painter.unpark(rig.canvas);
        Thread.sleep(300);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "still red above 150 ms (hysteresis)");
        rig.session.queue(100);
        rig.painter.unpark(rig.canvas);
        rig.awaitDeliveries(1);
        TestKit.check(rig.mapping.deliveries.size() == 1, "green again: sent");
        thread.interrupt();
    }

    /** Amber (150-400 ms): max_en_vuelo halves to 6. */
    private static void amberHalvesSlots() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.session.queue(200);
        int taken = 0;
        while (rig.session.takeSlot()) {
            taken++;
        }
        TestKit.check(taken == 6, "amber: 6 slots, got " + taken);
        rig.session.queue(20);
        TestKit.check(rig.session.takeSlot(), "green: back to 12");
    }

    /** A band whose CRC fails on disk: the delivery shrinks to the valid prefix before its header. */
    private static void corruptBandServesPrefix() throws Exception {
        PainterRig rig = PainterRig.create();
        WorkMeta meta = rig.canvas.meta();
        TestKit.FixedStore store = new TestKit.FixedStore(meta) {
            @Override
            public byte[][] servable(BrushId p, int from, int through) {
                return new byte[][]{new byte[]{10}}; // band 1 failed its CRC-32C
            }
        };
        store.put(new BrushId(1, 0, 0), new byte[]{10}, new byte[]{11}, new byte[]{12}, new byte[]{13});
        rig.canvas.setStore(store, meta);
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(1));
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1)),
                rig.canvas.plan().start(0, 1));
        rig.awaitDeliveries(1);
        var head = Headers.BrushHead.parse(ByteBuffer.wrap(rig.mapping.deliveries.get(0)));
        TestKit.check(head.from() == 0 && head.through() == 1, "header says [0,1), got " + head.through());
        TestKit.check(rig.canvas.book().get(head.delivery()).through() == 1, "book annotated with the prefix");
        thread.interrupt();
    }

    /** A band the store found bad twice: the next entry is cut to the valid prefix, or resolves quietly when none is. */
    private static void knownBadBandsClampBeforeOpen() throws Exception {
        PainterRig rig = PainterRig.create();
        WorkMeta meta = rig.canvas.meta();
        int[] valid = {1};
        TestKit.FixedStore store = new TestKit.FixedStore(meta) {
            @Override
            public int validBands(BrushId p) {
                return valid[0];
            }
        };
        store.put(new BrushId(1, 0, 0), new byte[]{10}, new byte[]{11}, new byte[]{12}, new byte[]{13});
        rig.canvas.setStore(store, meta);
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(1));
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 0, 3, 1)),
                rig.canvas.plan().start(0, 1));
        rig.awaitDeliveries(1);
        var head = Headers.BrushHead.parse(ByteBuffer.wrap(rig.mapping.deliveries.get(0)));
        TestKit.check(head.from() == 0 && head.through() == 1, "cut to the valid prefix [0,1), got " + head.through());
        TestKit.check(rig.canvas.book().get(head.delivery()).through() == 1, "the book holds the cut entry");
        valid[0] = 0;
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 0, 3, 1)),
                rig.canvas.plan().start(0, 1));
        long deadline = System.currentTimeMillis() + 5000;
        while (rig.planEvents(1) < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        TestKit.check(rig.planEvents(1) == 2, "no valid band: the plan still ends");
        TestKit.check(rig.mapping.deliveries.size() == 1, "and nothing more goes on the wire");
        thread.interrupt();
    }
}
