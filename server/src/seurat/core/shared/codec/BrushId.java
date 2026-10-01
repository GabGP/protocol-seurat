package seurat.core.shared.codec;

import java.util.List;
import seurat.core.shared.config.SeuratConstants;

/** Brush P(stratum,bx,by). id = stratum<<56 | morton. Value object. */
public record BrushId(int stratum, int bx, int by) {
    /** The stratum sits in the top byte of the id; the Morton code fills the other 56 bits. */
    private static final int STRATUM_SHIFT = 56;
    private static final long MORTON_MASK = (1L << STRATUM_SHIFT) - 1;

    public long id() {
        return ((long) stratum << STRATUM_SHIFT) | Morton.encode(bx, by);
    }

    public static BrushId ofId(long id) {
        int stratum = (int) (id >>> STRATUM_SHIFT);
        long m = id & MORTON_MASK;
        return new BrushId(stratum, Morton.decodeX(m), Morton.decodeY(m));
    }

    public BrushId parent() {
        return new BrushId(stratum + 1, bx >> 1, by >> 1);
    }

    /** Nearest ancestor that exists in a work with the given top (else seed). */
    public BrushId parentCapped(int top) {
        BrushId q = parent();
        while (q.stratum() < SeuratConstants.SEED_STRATUM && q.stratum() >= top) {
            q = q.parent();
        }
        return q.stratum() >= SeuratConstants.SEED_STRATUM ? seed() : q;
    }

    /** The seed brush: the single root every chain of parents ends at. */
    public static BrushId seed() {
        return new BrushId(SeuratConstants.SEED_STRATUM, 0, 0);
    }

    public List<BrushId> children() {
        if (stratum == 0) {
            return List.of();
        }
        int cx = bx << 1;
        int cy = by << 1;
        return List.of(new BrushId(stratum - 1, cx, cy), new BrushId(stratum - 1, cx + 1, cy),
                new BrushId(stratum - 1, cx, cy + 1), new BrushId(stratum - 1, cx + 1, cy + 1));
    }

    /** Native pixel footprint [x0,x1) x [y0,y1). */
    public long[] footprint() {
        long f = (long) Geometry.SIDE << stratum;
        return new long[]{(long) bx * f, (long) by * f, (long) (bx + 1) * f, (long) (by + 1) * f};
    }
}
