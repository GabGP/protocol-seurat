package seurat.session;

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
    private int deferredThrottle;

    /** A new PLAN INICIO replaces the pending plan; returns its generation. */
    public long start(long gazeSeq, long expectedCount) {
        seq = gazeSeq;
        expected = expectedCount;
        resolved = 0;
        lastNumber = 0;
        return ++generation;
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

    /** Regulation noticed after PLAN INICIO (budget at open): reported in the next PLAN INICIO. */
    public void defer(int flags) {
        deferredThrottle |= flags;
    }

    public int takeDeferred() {
        int out = deferredThrottle;
        deferredThrottle = 0;
        return out;
    }
}
