package seurat.concession;

import seurat.config.SeuratConstants;
import seurat.proto.ProtoCodes;

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
}
