package seurat.core.shared.codec;

import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;

/** Brush plane geometry (spec 2): one place for the side, its half, the parent count and band count. */
public final class Geometry {
    private Geometry() {}

    /** Side of a stratum's tile in pixels (a brush covers SIDE x SIDE of its stratum). */
    public static final int SIDE = SeuratConstants.BRUSH_SIDE;
    /** Side of a brush's parent plane: the 2x2 blocks of one tile. */
    public static final int HALF = SIDE / 2;
    /** Parents per brush plane, HALF x HALF. */
    public static final int PARENTS = HALF * HALF;
    /** Significance bands a brush is split into (spec 2.1). */
    public static final int BANDS = 4;
    /** Per-thread scratch for one brush's raw and compressed band bytes. */
    public static final int SCRATCH_BYTES = 512 * Units.BYTES_PER_KIB;

    /** Ceiling division for non-negative operands. */
    public static int ceilDiv(int value, int divisor) {
        return (value + divisor - 1) / divisor;
    }

    /** Tiles of SIDE pixels needed to cover {@code pixels}. */
    public static int tiles(int pixels) {
        return ceilDiv(pixels, SIDE);
    }

    public static int padTo(int v, int top) {
        return ((v + (1 << top) - 1) >> top) << top;
    }
}
