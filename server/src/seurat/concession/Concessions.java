package seurat.concession;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Predicate;
import seurat.config.SeuratConstants;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Delivery;

/** Concession arithmetic of spec 2.3 and the RASPAR predicates that realize a reduction. Pure. */
public final class Concessions {
    private Concessions() {}

    /** One RASPAR: the book-side predicate and its wire form (order, N filled in at send time). */
    public record Cut(Predicate<Delivery> scrape, MsgLoans.Scrape wire) {}

    /** Inactivity floor: only the sketch (7 on large works; the coarsest below the seed on small ones). */
    public static int sketchMin(int top) {
        return Math.min(SeuratConstants.SKETCH_MIN, Math.max(0, top - 1));
    }

    /** max_pinceladas = min(mem_mib x 3, sesion_max); max_kib = 48 x max_pinceladas. */
    public static Concession initial(long memMib, int sessionMax, int top) {
        int maxBrushes = (int) Math.min(memMib * 3, sessionMax);
        return new Concession(1, sketchMin(top), 4, ProtoCodes.MOT_INICIAL, maxBrushes,
                maxBrushes * 48, SeuratConstants.LEASE_S);
    }

    /** estrato_min = max(techo, piso); bandas_max = techo.bandas at the ceiling stratum, else 4. */
    public static int[] target(long[] ceiling, boolean floored, int top) {
        int min = (int) Math.max(ceiling[0], floored ? sketchMin(top) : 0);
        return new int[]{min, min == ceiling[0] ? (int) ceiling[1] : 4};
    }

    public static Concession next(Concession cur, int[] target, int motive) {
        return new Concession(cur.epoch() + 1, target[0], target[1], motive, cur.maxBrushes(),
                cur.maxKiB(), cur.leaseS());
    }

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
