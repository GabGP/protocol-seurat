package seurat.easel;

import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.observe.AuditLog;
import seurat.proto.Frame;
import seurat.proto.MsgAudit;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Wire;
import seurat.session.Canvas;
import seurat.session.Delivery;
import seurat.session.Mapping;
import seurat.session.Session;

/** Loan-side frames of an Easel: RECIBO, SOLTAR, RASPADO and INVENTARIO, each against the canvas book. */
final class LoanHandlers {
    private final Mapping mapping;
    private final EaselContext ctx;

    LoanHandlers(Mapping mapping, EaselContext ctx) {
        this.mapping = mapping;
        this.ctx = ctx;
    }

    void receipt(Session session, Frame f) {
        MsgLoans.Receipt receipt = Wire.parse(f.type(), () -> MsgLoans.Receipt.parse(f.payload()));
        Canvas canvas = HandleLookup.find(mapping, session, receipt.handle(), f.type());
        if (canvas == null) {
            return;
        }
        synchronized (canvas) {
            long now = System.nanoTime();
            long leaseNs = SeuratConstants.LEASE_S * Units.NANOS_PER_S;
            long skewNs = session.roundTrip.deltaNs();
            canvas.book().acknowledge(receipt.completed(), now, leaseNs, skewNs);
            canvas.book().settle(receipt.completed());
            for (var ranges : canvas.orders().takeRenewalsThrough(receipt.renewThrough())) {
                canvas.book().acknowledge(ranges, now, leaseNs, skewNs); // vence_srv from renov_hasta
            }
            canvas.free = receipt.free();
            session.queue(receipt.queueMs());
        }
        ctx.sessions().settled(session);
        ctx.grants().credit(canvas);
    }

    void release(Session session, Frame f) {
        MsgLoans.Release release = Wire.parse(f.type(), () -> MsgLoans.Release.parse(f.payload()));
        Canvas canvas = HandleLookup.find(mapping, session, release.handle(), f.type());
        if (canvas == null) {
            return;
        }
        synchronized (canvas) {
            if (release.reason() == ProtoCodes.SOLTAR_DECODIFICACION || release.reason() == ProtoCodes.SOLTAR_CRC) {
                release.ranges().forEach(n -> {
                    Delivery d = canvas.book().get(n);
                    if (d == null) {
                        return;
                    }
                    if (canvas.retryOnce(d.brush())) {
                        ctx.grants().resend(canvas, d); // spec 5.3: resent once, then unusable
                    } else if (release.reason() == ProtoCodes.SOLTAR_CRC) {
                        AuditLog.alert("s" + session.id() + "/c" + canvas.handle() + " CRC failed twice on "
                                + d.brush() + ": unusable in this session");
                    }
                });
            }
            canvas.book().release(release.ranges());
        }
        ctx.grants().credit(canvas);
    }

    void scraped(Session session, Frame f) {
        MsgLoans.Scraped scraped = Wire.parse(f.type(), () -> MsgLoans.Scraped.parse(f.payload()));
        Canvas canvas = HandleLookup.find(mapping, session, scraped.handle(), f.type());
        if (canvas != null) {
            ctx.grants().confirm(canvas, scraped);
            ctx.grants().credit(canvas);
        }
    }

    void inventory(Session session, Frame f) {
        MsgAudit.Inventory inventory = Wire.parse(f.type(), () -> MsgAudit.Inventory.parse(f.payload()));
        Canvas canvas = HandleLookup.find(mapping, session, inventory.handle(), f.type());
        if (canvas != null) {
            ctx.grants().audit(canvas, inventory);
        }
    }
}
