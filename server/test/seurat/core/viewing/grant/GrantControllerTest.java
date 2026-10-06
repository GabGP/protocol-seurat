package seurat.core.viewing.grant;

import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.FatalProtocol;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgAudit;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.CanvasOrders;
import seurat.kit.ConcessionRig;
import seurat.kit.TestKit;

/** Rights (spec 4.2): narrow ordering, exact confirm, cumulative orders, audits of issued orders. */
public final class GrantControllerTest {
    public static void main(String[] args) throws Exception {
        happyPath();
        mismatchFatal();
        cumulativeConfirm();
        audit();
        System.out.println("GrantControllerTest OK");
    }

    private static void narrowToStratum1(ConcessionRig s) {
        Concession c = s.canvas.concession();
        Concession next = new Concession(2, 1, 2, c.maxBrushes(), c.maxKiB(), 120);
        s.grants.narrow(s.canvas, next, Reductions.cuts(c, 1, 1, 2), null);
    }

    private static void happyPath() throws Exception {
        ConcessionRig s = ConcessionRig.create();
        narrowToStratum1(s);
        TestKit.check(s.canvas.concession().epoch() == 2, "epoch bumped");
        TestKit.check(s.canvas.orders().pendingScrapes().size() == 1, "order pending");
        TestKit.check(s.controlTypes().equals(List.of(FrameType.CONCESION, FrameType.RASPAR)),
                "CONCESION then RASPAR, got " + s.controlTypes());
        var order = s.canvas.orders().pendingScrapes().get(0);
        Ranges.Builder keep = new Ranges.Builder();
        keep.addRange(1, 256);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, order.order(), 2, order.through(), 0, 0, keep.build()));
        TestKit.check(s.canvas.orders().pendingScrapes().isEmpty(), "order resolved");
    }

    private static void mismatchFatal() throws Exception {
        ConcessionRig s = ConcessionRig.create();
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
        ConcessionRig s = ConcessionRig.create();
        Concession c = s.canvas.concession();
        s.canvas.setConcession(new Concession(1, 0, 1, c.maxBrushes(), c.maxKiB(), 120));
        s.canvas.book().log(new BrushId(0, 0, 0), 0, 4, 10, 1); // 257
        Concession cur = s.canvas.concession();
        s.grants.narrow(s.canvas, new Concession(2, 1, 2, c.maxBrushes(), c.maxKiB(), 120),
                Reductions.cuts(cur, 1, 1, 2), null);
        Concession mid = s.canvas.concession();
        s.grants.narrow(s.canvas, new Concession(3, 2, 2, c.maxBrushes(), c.maxKiB(), 120),
                Reductions.cuts(mid, 2, 1, 3), null);
        List<CanvasOrders.ScrapeOrder> pending = s.canvas.orders().pendingScrapes();
        TestKit.check(pending.size() == 2, "two orders pending");
        CanvasOrders.ScrapeOrder last = pending.get(1);
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, last.order(), 3, last.through(), 257, 0, Ranges.empty()));
        TestKit.check(s.canvas.orders().pendingScrapes().isEmpty(), "k confirms k-1 as well");
        s.grants.confirm(s.canvas, new MsgLoans.Scraped(1, pending.get(0).order(), 2, 257, 0, 0, Ranges.empty()));
    }

    private static void audit() throws Exception {
        ConcessionRig s = ConcessionRig.create();
        s.canvas.orders().next();
        s.canvas.orders().addAudit(new CanvasOrders.AuditOrder(1, 256, Long.MAX_VALUE));
        s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 1, 256, 256, 1000, s.canvas.book().numbersThrough(256)));
        try {
            s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 1, 256, 256, 1000, Ranges.of(1)));
            throw new AssertionError("expected: no such AUDITAR");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_PROTOCOLO, "an INVENTARIO answers an issued AUDITAR");
        }
        s.canvas.orders().addAudit(new CanvasOrders.AuditOrder(2, 256, Long.MAX_VALUE));
        try {
            s.grants.audit(s.canvas, new MsgAudit.Inventory(1, 2, 256, 256, 1000, Ranges.of(1)));
            throw new AssertionError("expected audit fatal");
        } catch (FatalProtocol fail) {
            TestKit.check(fail.code == ProtoCodes.ERR_POSESION, "audit ERROR 7");
        }
    }
}
