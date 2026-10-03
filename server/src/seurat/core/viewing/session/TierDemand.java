package seurat.core.viewing.session;

import java.util.Arrays;
import java.util.List;
import seurat.core.viewing.plan.PlanEntry;

/**
 * ADR-07 rule 2: the rate at which the live cone of a canvas wants new bytes, by tier (plan pass).
 * A plan for a new MIRADA brings its whole uncut cone; a replan of the same MIRADA only what it
 * adds to what the live plan still wants. Each tick folds the arrivals into a smoothed rate,
 * which is what the allotment compares with the capacity. Leaf lock.
 */
public final class TierDemand {
    /** Weight of one tick's arrivals in the rate: about a second of memory at 250 ms ticks. */
    private static final double RATE_GAIN = 1.0 / 4;

    /** What the live plan still wants. */
    private final long[] stock = new long[Allotment.TIERS];
    /** New want since the last tick. */
    private final long[] arrived = new long[Allotment.TIERS];
    /** Bytes per second. */
    private final double[] rate = new double[Allotment.TIERS];

    /** ADR-07 rule 2: the bytes entries want, by tier: their bands times the stratum mean bytes per band. */
    public static long[] estimate(List<PlanEntry> entries, CapacityMeter meter) {
        long[] wanted = new long[Allotment.TIERS];
        for (PlanEntry e : entries) {
            wanted[e.pass() - 1] += (long) ((e.through() - e.from()) * meter.bandBytes(e.brush().stratum()));
        }
        return wanted;
    }

    /** A new plan: what its uncut cone wants, by tier; newGaze when it answers a new MIRADA. */
    public synchronized void plan(long[] wanted, boolean newGaze) {
        for (int t = 0; t < Allotment.TIERS; t++) {
            arrived[t] += newGaze ? wanted[t] : Math.max(0, wanted[t] - stock[t]);
            stock[t] = wanted[t];
        }
    }

    /** A delivery opened: the live plan wants that much less. */
    public synchronized void opened(int pass, long spent) {
        if (pass >= 1 && pass <= Allotment.TIERS) {
            stock[pass - 1] = Math.max(0, stock[pass - 1] - spent);
        }
    }

    /** Hidden, or an empty plan: the canvas wants nothing. */
    public synchronized void clear() {
        Arrays.fill(stock, 0);
        Arrays.fill(arrived, 0);
        Arrays.fill(rate, 0);
    }

    /** Closes a tick of tickS seconds: its arrivals become part of the rate. */
    public synchronized void tick(double tickS) {
        for (int t = 0; t < Allotment.TIERS; t++) {
            rate[t] += RATE_GAIN * (arrived[t] / tickS - rate[t]);
            arrived[t] = 0;
        }
    }

    /** Adds this canvas's rate, bytes per second by tier, into sum. */
    public synchronized void addTo(long[] sum) {
        for (int t = 0; t < Allotment.TIERS; t++) {
            sum[t] += (long) rate[t];
        }
    }
}
