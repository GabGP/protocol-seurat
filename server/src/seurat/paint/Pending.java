package seurat.paint;

import seurat.plan.PlanEntry;
import seurat.session.Canvas;

/**
 * A plan entry waiting for the Painter. generation ties it to the PLAN it came
 * from (PLAN FIN accounting); RESEND marks a one-off resend outside any plan.
 */
public record Pending(Canvas canvas, PlanEntry entry, long queuedNs, long edition, long generation) {
    public static final long RESEND = -1;

    /** Spec 6.2: class = stratum, aged by one per 500 ms waiting, capped at 10 (the sketch). */
    public int effectiveClass(long nowNs) {
        long waitMs = (nowNs - queuedNs) / 1_000_000;
        return (int) Math.min(10, entry.brush().stratum() + waitMs / AGING_MS);
    }

    static final long AGING_MS = 500;
}
