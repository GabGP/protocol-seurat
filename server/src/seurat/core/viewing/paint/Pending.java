package seurat.core.viewing.paint;

import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.viewing.session.Canvas;

/**
 * A plan entry waiting for the Painter. generation ties it to the PLAN it came
 * from (PLAN FIN accounting).
 * readyNs is when it became "lista" (spec 6.3: its turn, and its session's own gates
 * allow it), the start of the CoDel dwell; UNREADY until then.
 */
public record Pending(Canvas canvas, PlanEntry entry, long queuedNs, long edition, long generation,
        long readyNs) {
    public static final long UNREADY = Long.MIN_VALUE;

    public Pending(Canvas canvas, PlanEntry entry, long queuedNs, long edition, long generation) {
        this(canvas, entry, queuedNs, edition, generation, UNREADY);
    }

    /** Spec 6.2: class = stratum, aged by one per 500 ms waiting, capped at 10 (the sketch). */
    public int effectiveClass(long nowNs) {
        long waitMs = (nowNs - queuedNs) / Units.NANOS_PER_MS;
        return (int) Math.min(SeuratConstants.SEED_STRATUM, entry.brush().stratum() + waitMs / AGING_MS);
    }

    boolean isReady() {
        return readyNs != UNREADY;
    }

    Pending readyAt(long nowNs) {
        return new Pending(canvas, entry, queuedNs, edition, generation, nowNs);
    }

    /** Gates closed again before it opened: its next dwell starts when they reopen. */
    Pending unready() {
        return new Pending(canvas, entry, queuedNs, edition, generation, UNREADY);
    }

    static final long AGING_MS = 500;
}
