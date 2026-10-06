package seurat.core.viewing.concession;

import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.proto.ProtoCodes;

/** Concession arithmetic of spec 2.3. Pure. */
public final class Concessions {
    private Concessions() {}

    /** Inactivity floor: only the sketch (7 on large works; the coarsest below the seed on small ones). */
    public static int sketchMin(int top) {
        return Math.min(SeuratConstants.SKETCH_MIN, Math.max(0, top - 1));
    }

    /** max_pinceladas = min(mem_mib x 3, sesion_max); max_kib = 48 x max_pinceladas. */
    public static Concession initial(long memMib, int sessionMax, int top) {
        int maxBrushes = (int) Math.min(memMib * 3, sessionMax);
        return new Concession(1, sketchMin(top), ProtoCodes.MOT_INICIAL, maxBrushes,
                maxBrushes * 48, SeuratConstants.LEASE_S);
    }

    /** estrato_min = max(ceiling, floor). */
    public static int target(int ceiling, boolean floored, int top) {
        return Math.max(ceiling, floored ? sketchMin(top) : 0);
    }

    public static Concession next(Concession cur, int minStratum, int motive) {
        return new Concession(cur.epoch() + 1, minStratum, motive, cur.maxBrushes(),
                cur.maxKiB(), cur.leaseS());
    }
}
