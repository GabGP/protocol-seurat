package seurat.core.viewing.session;

/**
 * The live PLAN of a canvas (spec 4.1.7): PLAN FIN goes out when every expected
 * entry is resolved (finished, discarded, or cancelled). Entries carry the plan
 * generation they came from, so a replaced plan's stragglers never count. Canvas lock.
 */
public final class PlanProgress {
    private long generation;
    private long seq;
    private long expected;
    private long resolved;
    private long lastNumber;
    /** Spec 6.3 rung (ConePlanner.rung) the live plan was cut to. */
    private int rung = Integer.MAX_VALUE;
    /** Spec 8 "Entrega parcial": one of its deliveries was cut before its FIN. */
    private boolean lost;

    /** A new PLAN INICIO replaces the pending plan; returns its generation. */
    public long start(long gazeSeq, long expectedCount) {
        seq = gazeSeq;
        expected = expectedCount;
        resolved = 0;
        lastNumber = 0;
        lost = false;
        return ++generation;
    }

    /** The load rung this plan was cut to; recovering past it plans the MIRADA again. */
    public void cutTo(int loadRung) {
        rung = loadRung;
    }

    /** A delivery was cancelled before its FIN: planned again with another number if still wanted. */
    public void lost() {
        lost = true;
    }

    /** Spec 6.3 and 8: the live MIRADA is due to be planned again. */
    public boolean stale(int loadRung) {
        return lost || loadRung > rung;
    }

    public long seq() {
        return seq;
    }

    public void numbered(long gen, long n) {
        if (gen == generation) {
            lastNumber = Math.max(lastNumber, n);
        }
    }

    /** One entry of plan gen is done; true exactly once, when the live plan completes. */
    public boolean resolve(long gen) {
        return gen == generation && expected > 0 && ++resolved == expected;
    }

    public long lastNumber() {
        return lastNumber;
    }
}
