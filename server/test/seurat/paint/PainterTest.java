package seurat.paint;

import java.nio.file.Files;
import java.util.List;
import seurat.budget.BrushBudget;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.plan.PlanEntry;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.Headers;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

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
        Rig rig = rig();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.book().settle(seurat.proto.Ranges.of(1));
        rig.canvas.free = 1;
        Thread thread = Thread.ofPlatform().daemon().start(rig.painter);
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        Thread.sleep(500);
        TestKit.check(rig.mapping.deliveries.size() == 1, "window 1: second entry parked, got "
                + rig.mapping.deliveries.size());
        rig.canvas.book().settle(seurat.proto.Ranges.of(2, 3));
        rig.painter.unpark(rig.canvas);
        long deadline = System.currentTimeMillis() + 5000;
        while (rig.mapping.deliveries.size() < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        TestKit.check(rig.mapping.deliveries.size() == 2, "credit releases the parked entry");
        thread.interrupt();
    }

    /** CERRAR drops a canvas's unopened entries: they never use the link afterwards. */
    private static void dropStopsCanvas() throws Exception {
        Rig rig = rig();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        rig.canvas.free = 0;
        Thread thread = Thread.ofPlatform().daemon().start(rig.painter);
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

    static class Rig {
        Painter painter;
        Canvas canvas;
        Session session;
        RecordingMapping mapping;
        TestKit.FixedStore store;
    }

    static Rig rig() throws Exception {
        Rig rig = new Rig();
        var root = Files.createTempDirectory("painter-test");
        var meta = new WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2);
        rig.store = new TestKit.FixedStore(meta);
        rig.store.put(new BrushId(1, 0, 0), new byte[]{10}, new byte[]{11},
                new byte[]{12}, new byte[]{13});
        rig.store.put(new BrushId(1, 1, 0), new byte[]{20}, new byte[]{21},
                new byte[]{22}, new byte[]{23});
        rig.mapping = new RecordingMapping();
        rig.painter = new Painter(new Regulator(),
                new BrushBudget(root.resolve("cov")), new Metrics());
        var sessions = new Sessions();
        rig.session = new Session(1, "p", "autenticado", 256, 3, rig.mapping,
                new byte[32]);
        sessions.add(rig.session);
        rig.canvas = new Canvas(1, "w", rig.store, meta,
                new Concession(1, 0, 4, 1, 768, 36864, 120));
        rig.canvas.session(rig.session);
        rig.session.canvases().put(1L, rig.canvas);
        return rig;
    }

    private static void happyPath() throws Exception {
        Rig rig = rig();
        rig.canvas.book().log(new BrushId(10, 0, 0), 0, 1, 10, 1);
        Thread thread = Thread.ofPlatform().daemon().start(rig.painter);
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(1, 1, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        long deadline = System.currentTimeMillis() + 5000;
        while (rig.mapping.deliveries.size() < 2 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        TestKit.check(rig.mapping.deliveries.size() == 2, "two deliveries");
        var first = Headers.BrushHead.parse(java.nio.ByteBuffer.wrap(
                rig.mapping.deliveries.get(0)));
        var second = Headers.BrushHead.parse(java.nio.ByteBuffer.wrap(
                rig.mapping.deliveries.get(1)));
        long lo = Math.min(first.delivery(), second.delivery());
        long hi = Math.max(first.delivery(), second.delivery());
        TestKit.check(lo == 2 && hi == 3, "numbers {2,3} before bytes");
        TestKit.check(rig.canvas.book().lastNumber() == 3, "book annotated");
        deadline = System.currentTimeMillis() + 5000;
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
        Rig rig = rig();
        Thread thread = Thread.ofPlatform().daemon().start(rig.painter);
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(0, 0, 0), 0, 4, 1),
                new PlanEntry(new BrushId(1, 0, 0), 0, 4, 1),
                new PlanEntry(new BrushId(9, 9, 9), 0, 2, 1)), rig.canvas.plan().start(0, 3));
        Thread.sleep(700);
        TestKit.check(rig.mapping.deliveries.isEmpty(), "a/b violations dropped, got "
                + rig.mapping.deliveries.size());
        TestKit.check(planEvents(rig, 1) == 1, "PLAN FIN once every entry is resolved");
        thread.interrupt();
    }

    static int planEvents(Rig rig, int event) {
        int n = 0;
        synchronized (rig.mapping) {
            for (byte[] frame : rig.mapping.control) {
                Frame f = Frame.decode(java.nio.ByteBuffer.wrap(frame));
                if (f.type() == FrameType.PLAN && seurat.proto.MsgGaze.Plan.parse(f.payload()).event() == event) {
                    n++;
                }
            }
        }
        return n;
    }

    private static void purgeCancels() throws Exception {
        Rig rig = rig();
        rig.painter.enqueue(rig.canvas, List.of(
                new PlanEntry(new BrushId(0, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(2, 0, 0), 0, 2, 1)), rig.canvas.plan().start(0, 2));
        Concession narrow = new Concession(2, 2, 4, 1, 768, 36864, 120);
        var cancelled = rig.painter.purge(rig.canvas, narrow);
        TestKit.check(cancelled.isEmpty(), "queue purged cleanly");
    }
}
