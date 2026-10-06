package seurat.core.viewing.grant;

import java.util.List;
import java.util.function.Predicate;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.Delivery;
import seurat.core.viewing.session.Canvas;

/** The RASPAR predicate that realizes a reduction (spec 2.3) and the CONCESION message of a canvas. */
public final class Reductions {
    private Reductions() {}

    /** One RASPAR: the book-side predicate and its wire form (order, N filled in at send time). */
    public record Cut(Predicate<Delivery> scrape, MsgLoans.Scrape wire) {}

    /** What the reduction cur -> target takes back; empty when target is not smaller anywhere. */
    public static List<Cut> cuts(Concession cur, int target, long handle, long epoch) {
        if (target > cur.minStratum()) {
            return List.of(new Cut(lowStratum(target), MsgLoans.Scrape.lowStratum(handle, 0, epoch, 0, target)));
        }
        return List.of();
    }

    public static MsgGaze.ConcessionMessage message(Canvas canvas) {
        Concession c = canvas.concession();
        return new MsgGaze.ConcessionMessage(canvas.handle(), c.epoch(), c.minStratum(), c.reason(),
                c.maxBrushes(), c.maxKiB(), c.leaseS());
    }

    /** ESTRATO_BAJO: s < stratum; never the sketch since stratum <= sketchMin. */
    public static Predicate<Delivery> lowStratum(int stratum) {
        return delivery -> delivery.brush().stratum() < stratum;
    }

    public static Predicate<Delivery> all() {
        return delivery -> true;
    }
}
