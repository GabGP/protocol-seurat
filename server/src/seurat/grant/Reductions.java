package seurat.grant;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;
import seurat.concession.Concession;
import seurat.proto.msg.MsgGaze;
import seurat.proto.msg.MsgLoans;
import seurat.session.Canvas;
import seurat.session.Delivery;

/** The RASPAR predicates that realize a reduction (spec 2.3) and the CONCESION message of a canvas. */
public final class Reductions {
    private Reductions() {}

    /** One RASPAR: the book-side predicate and its wire form (order, N filled in at send time). */
    public record Cut(Predicate<Delivery> scrape, MsgLoans.Scrape wire) {}

    /** What the reduction cur -> target takes back; empty when target is not smaller anywhere. */
    public static List<Cut> cuts(Concession cur, int[] target, long handle, long epoch) {
        List<Cut> out = new ArrayList<>();
        int min = target[0];
        int bands = target[1];
        if (min > cur.minStratum()) {
            out.add(new Cut(lowStratum(min), MsgLoans.Scrape.lowStratum(handle, 0, epoch, 0, min)));
        }
        int heldAtMin = min > cur.minStratum() ? 4 : min == cur.minStratum() ? cur.maxBands() : 0;
        if (bands < heldAtMin) {
            out.add(new Cut(d -> d.brush().stratum() == min && d.through() > bands,
                    MsgLoans.Scrape.bands(handle, 0, epoch, 0, min, bands)));
        }
        return out;
    }

    public static MsgGaze.ConcessionMessage message(Canvas canvas) {
        Concession c = canvas.concession();
        return new MsgGaze.ConcessionMessage(canvas.handle(), c.epoch(), c.minStratum(),
                c.maxBands(), c.reason(), c.maxBrushes(), c.maxKiB(), c.leaseS());
    }

    /** ESTRATO_BAJO: s < stratum; never the sketch since stratum <= sketchMin. */
    public static Predicate<Delivery> lowStratum(int stratum) {
        return delivery -> delivery.brush().stratum() < stratum;
    }

    public static Predicate<Delivery> all() {
        return delivery -> true;
    }
}
