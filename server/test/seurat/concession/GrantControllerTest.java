package seurat.concession;

import java.nio.file.Files;
import java.util.List;
import seurat.budget.BrushBudget;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.net.RecordingMapping;
import seurat.observe.Metrics;
import seurat.paint.Painter;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.CanvasOrders;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;
import seurat.store.WorkMeta;

/** Rights (spec 4.2): narrow ordering, exact confirm, cumulative orders, audits of issued orders. */
public final class GrantControllerTest {
    public static void main(String[] args) throws Exception {
        happyPath();
        mismatchFatal();
        cumulativeConfirm();
        audit();
        System.out.println("GrantControllerTest OK");
    }

    static class Setup {
        Sessions sessions;
        Catalog catalog;
        WorkRecord work;
        GrantController grants;
        Session session;
        Canvas canvas;
        RecordingMapping mapping;
    }

    static Setup setup(int state) throws Exception {
        Setup s = new Setup();
        var root = Files.createTempDirectory("grants-test");
        s.sessions = new Sessions();
        s.catalog = new Catalog(root.resolve("obras"));
        var meta = new WorkMeta("w", "w", 512, 384, 256, 2, state, 2, 0, 2);
        s.work = new WorkRecord(meta);
        var store = new TestKit.FixedStore(meta);
        for (int bx = 0; bx < 2; bx++) {
            for (int by = 0; by < 2; by++) {
                store.put(new BrushId(0, bx, by), new byte[]{1}, new byte[]{2}, new byte[]{3}, new byte[]{4});
            }
        }
        s.work.store = store;
        s.catalog.register(s.work);
        var painter = new Painter(new Regulator(), new BrushBudget(root.resolve("cov")), new Metrics());
        s.mapping = new RecordingMapping();
        s.grants = new GrantController(s.catalog, painter, s.sessions);
        s.session = new Session(1, "p", WorkRecord.AUTHENTICATED, 256, 3, s.mapping, new byte[32]);
        s.sessions.add(s.session);
        s.canvas = new Canvas(1, "w", store, meta, new Concession(1, 0, 2, 1, 768, 36864, 120));
        s.canvas.session(s.session);
        s.session.canvases().put(1L, s.canvas);
        for (long n = 1; n <= 256; n++) {
            s.canvas.book().log(new BrushId(1, (int) (n % 64), (int) (n / 64)), 0, 4, 10, 2);
        }
        return s;
    }

    static Setup setup() throws Exception {
        return setup(ProtoCodes.ST_LISTA);
    }

    static List<Long> controlTypes(Setup s) {
        var out = new java.util.ArrayList<Long>();
        synchronized (s.mapping) {
            for (byte[] frame : s.mapping.control) {
                out.add(Frame.decode(java.nio.ByteBuffer.wrap(frame)).type());
            }
        }
        return out;
    }

    private static void narrowToStratum1(Setup s) {
        Concession c = s.canvas.concession();
        Concession next = new Concession(2, 1, 4, 2, c.maxBrushes(), c.maxKiB(), 120);
        s.grants.narrow(s.canvas, next, Concessions.cuts(c, new int[]{1, 4}, 1, 2), null);
    }

    private static void happyPath() throws Exception {
        Setup s = setup();
        narrowToStratum1(s);
        TestKit.check(s.canvas.concession().epoch() == 2, "epoch bumped");
        TestKit.check(s.canvas.orders().pendingScrapes().size() == 1, "order pending");
        TestKit.check(controlTypes(s).equals(List.of(FrameType.CONCESION, FrameType.RASPAR)),
                "CONCESION then RASPAR, got " + controlTypes(s));
        var order = s.canvas.orders().pendingScrapes().get(0);
        Ranges.Builder keep = new Ranges.Builder();
        keep.addRange(1, 256);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, order.order(), 2, order.through(), 0, 0, keep.build()));
        TestKit.check(s.canvas.orders().pendingScrapes().isEmpty(), "order resolved");
    }

    private static void mismatchFatal() throws Exception {
        Setup s = setup();
        narrowToStratum1(s);
        var order = s.canvas.orders().pendingScrapes().get(0);
        try {
            s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, order.order(), 2, order.through(), 0, 0,
                    Ranges.of(1, 2, 3)));
            throw new AssertionError("expected ERROR 7");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_POSESION, "ERROR 7");
        }
    }

    /** Spec 4.2.5: the RASPADO of order k confirms every earlier pending order too. */
    private static void cumulativeConfirm() throws Exception {
        Setup s = setup();
        Concession c = s.canvas.concession();
        s.canvas.setConcession(new Concession(1, 0, 4, 1, c.maxBrushes(), c.maxKiB(), 120));
        s.canvas.book().log(new BrushId(0, 0, 0), 0, 4, 10, 1); // 257
        Concession cur = s.canvas.concession();
        s.grants.narrow(s.canvas, new Concession(2, 0, 2, 2, c.maxBrushes(), c.maxKiB(), 120),
                Concessions.cuts(cur, new int[]{0, 2}, 1, 2), null);
        Concession mid = s.canvas.concession();
        s.grants.narrow(s.canvas, new Concession(3, 2, 4, 2, c.maxBrushes(), c.maxKiB(), 120),
                Concessions.cuts(mid, new int[]{2, 4}, 1, 3), null);
        List<CanvasOrders.ScrapeOrder> pending = s.canvas.orders().pendingScrapes();
        TestKit.check(pending.size() == 2, "two orders pending");
        CanvasOrders.ScrapeOrder last = pending.get(1);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, last.order(), 3, last.through(), 257, 0, Ranges.empty()));
        TestKit.check(s.canvas.orders().pendingScrapes().isEmpty(), "k confirms k-1 as well");
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, pending.get(0).order(), 2, 257, 0, 0, Ranges.empty()));
    }

    private static void audit() throws Exception {
        Setup s = setup();
        s.canvas.orders().next();
        s.canvas.orders().addAudit(new CanvasOrders.AuditOrder(1, 256));
        s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 1, 256, 256, 1000, s.canvas.book().numbersThrough(256)));
        try {
            s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 1, 256, 256, 1000, Ranges.of(1)));
            throw new AssertionError("expected: no such AUDITAR");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_PROTOCOLO, "an INVENTARIO answers an issued AUDITAR");
        }
        s.canvas.orders().addAudit(new CanvasOrders.AuditOrder(2, 256));
        try {
            s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 2, 256, 256, 1000, Ranges.of(1)));
            throw new AssertionError("expected audit fatal");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_POSESION, "audit ERROR 7");
        }
    }
}
