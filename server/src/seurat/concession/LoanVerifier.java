package seurat.concession;

import java.util.List;
import java.util.function.Predicate;
import seurat.observe.Log;
import seurat.proto.FatalProtocol;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.CanvasOrders;
import seurat.session.Delivery;

/** Exact-set confirmation of RASPADO / INVENTARIO (spec 4.2.5, 4.2.7), or fatal ERROR 7. */
final class LoanVerifier {
    private LoanVerifier() {}

    /** RASPADO of order k confirms k and every earlier pending order (they were applied in order). */
    static void confirm(Canvas canvas, MsgLoans.Scraped scraped) {
        List<CanvasOrders.ScrapeOrder> done;
        synchronized (canvas) {
            CanvasOrders.ScrapeOrder order = canvas.orders().scrape(scraped.order());
            if (order == null) {
                if (!canvas.orders().issued(scraped.order())) {
                    throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, FrameType.RASPADO, "unknown orden");
                }
                return; // already confirmed by a later RASPADO
            }
            if (scraped.through() != order.through() || scraped.epoch() != order.epoch()) {
                throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, FrameType.RASPADO, "hasta/epoca mismatch");
            }
            done = canvas.orders().scrapesThrough(scraped.order());
            Predicate<Delivery> scrape = d -> false;
            Ranges.Builder cancelled = new Ranges.Builder();
            for (CanvasOrders.ScrapeOrder o : done) {
                Predicate<Delivery> p = o.scrape();
                long n = o.through();
                scrape = scrape.or(d -> d.number() <= n && p.test(d));
                o.cancelled().forEach(cancelled::add);
            }
            Ranges expected = canvas.book().expected(order.through(), scrape, cancelled.build());
            if (!expected.equals(scraped.kept())) {
                Log.warn("audit", "Scrape possession mismatch on canvas " + canvas.handle()
                        + ": expected " + expected + ", got " + scraped.kept());
                throw new FatalProtocol(ProtoCodes.ERR_POSESION, FrameType.RASPADO, "POSESION_DISCREPANTE");
            }
            canvas.book().retainOnly(order.through(), scraped.kept());
            canvas.orders().resolveThrough(scraped.order());
        }
        for (CanvasOrders.ScrapeOrder o : done) {
            if (o.then() != null) {
                o.then().run();
            }
        }
    }

    /** INVENTARIO must answer an AUDITAR actually issued, for its hasta_entrega. */
    static void audit(Canvas canvas, MsgAudit.Inventory inventory) {
        synchronized (canvas) {
            CanvasOrders.AuditOrder issued = canvas.orders().takeAudit(inventory.order());
            if (issued == null || issued.through() != inventory.through()) {
                throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, FrameType.INVENTARIO, "no such AUDITAR");
            }
            var expected = canvas.book().numbersThrough(inventory.through());
            if (!expected.equals(inventory.ranges())) {
                Log.warn("audit", "Inventory audit mismatch on canvas " + canvas.handle()
                        + ": order=" + inventory.order() + " through=" + inventory.through()
                        + " expected " + expected + ", got " + inventory.ranges());
                throw new FatalProtocol(ProtoCodes.ERR_POSESION, FrameType.INVENTARIO, "POSESION_DISCREPANTE");
            }
        }
    }
}
