package seurat.core.viewing.paint;

import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.Frame;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.Headers;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.plan.PlanEntry;
import seurat.kit.PainterRig;
import seurat.kit.TestKit;

/** Painter: checks a-e order, annotate-before-bytes, PLAN FIN. */
public final class PainterTest {
    public static void main(String[] args) throws Exception {
        happyPath();
        dropsViolations();
        purgeCancels();
        receiverWindowPaces();
        dropStopsCanvas();
        System.out.println("PainterTest OK");
    }

    /** RECIBO.libre caps unconfirmed deliveries; a settle + unpark (RECIBO) releases the next. */
    private static void receiverWindowPaces() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(1));
        rig.canvas.free = 1;
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        Thread.sleep(500);
        TestKit.check(rig.mapping.deliveries.size() == 1, "window 1: second entry parked, got "
                + rig.mapping.deliveries.size());
        rig.canvas.book().settle(seurat.core.shared.proto.Ranges.of(2, 3));
        rig.painter.unpark(rig.canvas);
        rig.awaitDeliveries(2);
        TestKit.check(rig.mapping.deliveries.size() == 2, "credit releases the parked entry");
        thread.interrupt();
    }

    /** CERRAR drops a canvas's unopened entries: they never use the link afterwards. */
    private static void dropStopsCanvas() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.free = 0;
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1)),
                rig.canvas.plan().start(0, 1));
        Thread.sleep(300);
        rig.painter.drop(rig.canvas);
        rig.canvas.free = 10;
        rig.painter.unpark(rig.canvas);
        Thread.sleep(300);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "dropped entries never sent");
        thread.interrupt();
    }

    private static void happyPath() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        rig.awaitDeliveries(2);
        TestKit.check(rig.mapping.deliveries.size() == 2, "two deliveries");
        var first = Headers.BrushHead.parse(java.nio.ByteBuffer.wrap(
                rig.mapping.deliveries.get(0)));
        var second = Headers.BrushHead.parse(java.nio.ByteBuffer.wrap(
                rig.mapping.deliveries.get(1)));
        long lo = Math.min(first.delivery(), second.delivery());
        long hi = Math.max(first.delivery(), second.delivery());
        TestKit.check(lo == 2 && hi == 3, "numbers {2,3} before bytes");
        TestKit.check(rig.canvas.book().lastNumber() == 3, "book annotated");
        long deadline = System.currentTimeMillis() + 5000;
        boolean fin = false;
        while (!fin && System.currentTimeMillis() < deadline) {
            for (byte[] frame : rig.mapping.control) {
                if (Frame.decode(java.nio.ByteBuffer.wrap(frame)).type()
                        == FrameType.PLAN) {
                    fin = true;
                }
            }
            Thread.sleep(20);
        }
        TestKit.check(fin, "PLAN FIN sent");
        thread.interrupt();
    }

    /** (a)(b) failures are discarded, and a plan made only of them still ends with PLAN FIN. */
    private static void dropsViolations() throws Exception {
        PainterRig rig = PainterRig.create();
        Thread thread = rig.start();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(0, 0, 0), 0, 4, 1),
                new PlanEntry(new BrushId(1, 0, 0), 0, 4, 1),
                new PlanEntry(new BrushId(9, 9, 9), 0, 2, 1)), rig.canvas.plan().start(0, 3));
        Thread.sleep(700);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "a/b violations dropped, got "
                + rig.mapping.deliveries.size());
        TestKit.check(rig.planEvents(1) == 1, "PLAN FIN once every entry is resolved");
        thread.interrupt();
    }

    private static void purgeCancels() throws Exception {
        PainterRig rig = PainterRig.create();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(0, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(2, 0, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        Concession narrow = new Concession(2, 2, 4, 1, 768, 36864, 120);
        var cancelled = rig.painter.purge(rig.canvas, narrow);
        TestKit.check(cancelled.isEmpty(), "queue purged cleanly");
    }
}
