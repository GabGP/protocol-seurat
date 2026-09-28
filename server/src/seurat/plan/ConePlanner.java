package seurat.plan;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.proto.MsgGaze;
import seurat.proto.ProtoCodes;
import seurat.session.Concession;

/** Stateless cone: MIRADA + concession + book -> 3-pass delivery list. */
public final class ConePlanner {
    private ConePlanner() {}

    public record ConePlan(List<PlanEntry> entries, int throttle) {}

    /** Spec 6.3's staircase on e_i: 3 normal, 2 no ring 2, 1 focus <= 2 bands, 0 focus one stratum coarser. */
    public static int rung(double share) {
        return share >= 0.75 ? 3 : share >= 0.5 ? 2 : share >= 0.25 ? 1 : 0;
    }

    public static ConePlan plan(MsgGaze.Gaze gaze, Concession concession, BookView book,
            seurat.store.WorkMeta meta, double share, long queueMs) {
        int top = meta.strata() - 1;
        if (top <= 0) {
            return new ConePlan(List.of(), 0);
        }
        long width = meta.width();
        long height = meta.height();
        double ideal = log2(Math.max((gaze.x1() - gaze.x0()) / (double) gaze.vw(),
                (gaze.y1() - gaze.y0()) / (double) gaze.vh()));
        int idealStratum = Math.max(0, Math.min(10, (int) Math.floor(ideal)));
        double phi = ideal <= 0 || idealStratum == 10 ? 0 : ideal - idealStratum;
        int bands = 4 - (int) Math.floor(4 * phi);
        int focusStratum = Math.min(top - 1 < 0 ? 0 : top - 1,
                Math.max(idealStratum, concession.minStratum()));
        focusStratum = Math.max(0, focusStratum);
        int focusBands = focusStratum == idealStratum ? bands : 4;
        if (focusStratum == concession.minStratum()) {
            focusBands = Math.min(focusBands, concession.maxBands());
        }
        int flags = 0;
        boolean ring2 = true;
        int ring1Bands = 2;
        int focusCap = 4;
        int rung = rung(share);
        if (rung < 3) {
            flags |= ProtoCodes.REG_CARGA;
            ring2 = false;
            ring1Bands = 1;
        }
        if (rung < 2) {
            focusCap = 2;
        }
        if (rung < 1) {
            focusStratum = Math.min(top - 1 < 0 ? 0 : top - 1, focusStratum + 1);
            focusBands = 4;
            if (focusStratum == concession.minStratum()) {
                focusBands = Math.min(focusBands, concession.maxBands());
            }
        }
        if (queueMs >= SeuratConstants.QUEUE_AMBER_MS) {
            // Amber and red (spec 6.1): new focus entries capped to 2 bands; the Painter halves
            // max_en_vuelo and, while red, opens nothing until cola_ms is back under 150 ms.
            flags |= ProtoCodes.REG_COLA;
            focusCap = Math.min(focusCap, 2);
        }
        Map<BrushId, Integer> want = new LinkedHashMap<>();
        long cx = (gaze.x0() + gaze.x1()) / 2;
        long cy = (gaze.y0() + gaze.y1()) / 2;
        List<BrushId> focus = ConeTiling.tile(focusStratum, gaze.x0(), gaze.y0(),
                gaze.x1(), gaze.y1(), width, height);
        for (BrushId brush : focus) {
            want.merge(brush, Math.min(focusBands, focusCap), Math::max);
        }
        for (BrushId brush : focus) {
            BrushId parent = brush.parentCapped(top);
            while (true) {
                want.merge(parent, 4, Math::max);
                if (parent.stratum() >= 10) {
                    break;
                }
                parent = parent.parentCapped(top);
            }
        }
        if (focusStratum + 1 < top) {
            long[] ring1 = ConeTiling.ring(gaze, 1);
            for (BrushId brush : ConeTiling.tile(focusStratum + 1, ring1[0], ring1[1],
                    ring1[2], ring1[3], width, height)) {
                want.merge(brush, ring1Bands, Math::max);
            }
        }
        if (ring2 && focusStratum + 2 < top) {
            long[] ring2Box = ConeTiling.ring(gaze, 2);
            for (BrushId brush : ConeTiling.tile(focusStratum + 2, ring2Box[0], ring2Box[1],
                    ring2Box[2], ring2Box[3], width, height)) {
                want.merge(brush, 1, Math::max);
            }
        }
        for (int stratum = 0; stratum < 10; stratum++) {
            List<Map.Entry<BrushId, Integer>> level = new ArrayList<>();
            for (var need : want.entrySet()) {
                if (need.getKey().stratum() == stratum) {
                    level.add(need);
                }
            }
            for (var need : level) {
                BrushId parent = need.getKey().parentCapped(top);
                if (parent.stratum() != need.getKey().stratum()) {
                    want.merge(parent, need.getValue(), Math::max);
                }
            }
        }
        want.put(new BrushId(10, 0, 0), 4);
        return ConePasses.split(want, focus, book, cx, cy, flags, top);
    }

    private static double log2(double v) {
        return Math.log(v) / Math.log(2);
    }
}
