package seurat.core.viewing.grant;

import java.util.List;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.loans.CanvasOrders;
import seurat.core.viewing.session.Canvas;

/** Sends CANCELADAS and one RASPAR per cut, and registers each order until its RASPADO (spec 4.2.2). */
final class ScrapeIssuer {
    void issue(Canvas canvas, long n, long epoch, Ranges cancelled,
            List<Reductions.Cut> cuts, Runnable then) {
        if (!cancelled.isEmpty()) {
            GrantController.send(canvas.session(), FrameType.PLAN,
                    MsgGaze.Plan.cancelled(canvas.handle(), canvas.plan().seq(), cancelled).encode());
        }
        long deadline = System.nanoTime() + SeuratConstants.SCRAPE_TIMEOUT_S * Units.NANOS_PER_S;
        for (int i = 0; i < cuts.size(); i++) {
            long order = canvas.orders().next();
            MsgLoans.Scrape wire = cuts.get(i).wire().at(order, n);
            GrantController.send(canvas.session(), FrameType.RASPAR, wire.encode());
            canvas.orders().addScrape(new CanvasOrders.ScrapeOrder(order, n, epoch, cuts.get(i).scrape(),
                    cancelled, deadline, i == cuts.size() - 1 ? then : null, wire));
        }
    }
}
