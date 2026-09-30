package seurat.plan;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.proto.msg.MsgGaze;
import seurat.store.WorkMeta;

/** Brush tiling over ROIs and rings, plus the opening sketch list. */
public final class ConeTiling {
    private ConeTiling() {}

    static long[] ring(MsgGaze.Gaze gaze, int j) {
        long cx = (gaze.x0() + gaze.x1()) / 2;
        long cy = (gaze.y0() + gaze.y1()) / 2;
        long k = 1L << j;
        return new long[]{cx - (cx - gaze.x0()) * k, cy - (cy - gaze.y0()) * k,
                cx + (gaze.x1() - cx) * k, cy + (gaze.y1() - cy) * k};
    }

    static List<BrushId> tile(int stratum, long x0, long y0, long x1, long y1,
            long width, long height) {
        List<BrushId> out = new ArrayList<>();
        if (x1 <= x0 || y1 <= y0 || stratum > SeuratConstants.SEED_STRATUM) {
            return out;
        }
        long f = 256L << stratum;
        long bx0 = Math.max(0, Math.floorDiv(x0, f));
        long by0 = Math.max(0, Math.floorDiv(y0, f));
        long bx1 = Math.min(Math.floorDiv(x1 - 1, f), Math.floorDiv(width - 1, f));
        long by1 = Math.min(Math.floorDiv(y1 - 1, f), Math.floorDiv(height - 1, f));
        for (long by = by0; by <= by1; by++) {
            for (long bx = bx0; bx <= bx1; bx++) {
                out.add(new BrushId(stratum, (int) bx, (int) by));
            }
        }
        return out;
    }

    static long dist2(BrushId b, long cx, long cy) {
        long f = 256L << b.stratum();
        long px = b.bx() * f + f / 2 - cx;
        long py = b.by() * f + f / 2 - cy;
        return px * px + py * py;
    }

    /** Opening sketch: seed + coarsest allowed brushes, coarse first. */
    public static List<PlanEntry> sketch(WorkMeta meta, int minStratum, BookView book) {
        List<PlanEntry> out = new ArrayList<>();
        BrushId seed = BrushId.seed();
        if (book.bands(seed) < 1) {
            out.add(new PlanEntry(seed, 0, 1, 1));
        }
        int top = meta.strata() - 1;
        int coarse = top - 1;
        int fine = Math.max(minStratum, coarse - 2);
        for (int stratum = coarse; stratum >= fine; stratum--) {
            List<PlanEntry> level = new ArrayList<>();
            for (BrushId b : tile(stratum, 0, 0, meta.width(), meta.height(),
                    meta.width(), meta.height())) {
                int held = book.bands(b);
                if (held < 4) {
                    level.add(new PlanEntry(b, held, 4, 1));
                }
            }
            level.sort(Comparator.comparingInt((PlanEntry pe) -> pe.brush().bx())
                    .thenComparingInt(pe -> pe.brush().by()));
            out.addAll(level);
        }
        return out;
    }
}
