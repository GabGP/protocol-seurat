package seurat.core.viewing.paint;

import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.viewing.session.Canvas;

/**
 * A plan entry waiting for the Painter. generation ties it to the PLAN it came
 * from (PLAN FIN accounting).
 */
public record Pending(Canvas canvas, PlanEntry entry, long queuedNs, long edition, long generation) {
    /** Spec 6.2: class = stratum, aged by one per 500 ms waiting, capped at 10 (the sketch). */
    public int effectiveClass(long nowNs) {
        long waitMs = (nowNs - queuedNs) / Units.NANOS_PER_MS;
        return (int) Math.min(SeuratConstants.SEED_STRATUM, entry.brush().stratum() + waitMs / AGING_MS);
    }

    static final long AGING_MS = 500;
}
