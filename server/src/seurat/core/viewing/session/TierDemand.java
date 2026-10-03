package seurat.core.viewing.session;

import java.util.Arrays;
import java.util.List;
import seurat.core.viewing.plan.PlanEntry;

/**
 * ADR-07 rule 2: the bytes the live cone of a canvas still wants, by tier (plan pass).
 * Estimated when the plan is made, and spent as deliveries open. Leaf lock.
 */
public final class TierDemand {
    private final long[] bytes = new long[Allotment.TIERS];

    /** ADR-07 rule 2: the bytes entries want, by tier: their bands times the stratum mean bytes per band. */
    public static long[] estimate(List<PlanEntry> entries, CapacityMeter meter) {
        long[] wanted = new long[Allotment.TIERS];
        for (PlanEntry e : entries) {
            wanted[e.pass() - 1] += (long) ((e.through() - e.from()) * meter.bandBytes(e.brush().stratum()));
        }
        return wanted;
    }

    /**
     * A new plan; what its uncut cone wants, by tier.
     *
     * @param wanted array of wanted bytes per tier
     */
    public synchronized void plan(long[] wanted) {
        int count = Math.min(wanted.length, Allotment.TIERS);
        System.arraycopy(wanted, 0, bytes, 0, count);
        Arrays.fill(bytes, count, Allotment.TIERS, 0);
    }

    /**
     * A delivery opened; subtracts its bytes from the tier's remaining demand.
     *
     * @param pass the 1-indexed plan pass
     * @param spent the bytes opened
     */
    public synchronized void opened(int pass, long spent) {
        if (pass >= 1 && pass <= Allotment.TIERS) {
            bytes[pass - 1] = Math.max(0, bytes[pass - 1] - spent);
        }
    }

    /** Resets all tier demands to zero. */
    public synchronized void clear() {
        Arrays.fill(bytes, 0);
    }

    /**
     * Adds the demand of each tier into the given accumulator array.
     *
     * @param sum the accumulator array
     */
    public synchronized void addTo(long[] sum) {
        int limit = Math.min(sum.length, Allotment.TIERS);
        for (int t = 0; t < limit; t++) {
            sum[t] += bytes[t];
        }
    }
}
