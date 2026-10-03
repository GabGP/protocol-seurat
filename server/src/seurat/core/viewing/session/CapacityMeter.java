package seurat.core.viewing.session;

import java.util.Arrays;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.config.Units;

/**
 * ADR-07 rule 1: the bytes per second the Painter can open,
 * measured in busy time, and the mean bytes per band of each stratum.
 */
public final class CapacityMeter {
    /** The Painter was not the bottleneck, so nobody is cut. */
    public static final long UNBOUNDED = Long.MAX_VALUE;
    /** The busy fraction at or above which the Painter is the bottleneck. */
    private static final double SATURATED = 0.5;
    /** The saturated ticks kept; the capacity is their median. */
    private static final int SAMPLES = 5;
    /** The weight of a new delivery in a stratum mean. */
    private static final double MEAN_GAIN = 1.0 / 8;
    /** The mean bytes per band before a stratum has a delivery. */
    private static final double PRIOR_BAND_BYTES = 8192.0;

    private final double[] bandBytes = new double[SeuratConstants.SEED_STRATUM + 1];
    private final long[] samples = new long[SAMPLES];
    private int count;
    private int next;
    private boolean waiting;
    private long sinceNs;
    private long busyNs;
    private long openedBytes;
    /** -1 until the first sample starts the first tick. */
    private long tickStartNs = -1;

    /** Creates a new capacity meter initialized with prior band means. */
    public CapacityMeter() {
        Arrays.fill(bandBytes, PRIOR_BAND_BYTES);
    }

    /** The Painter decided whether a ready entry is left unopened from now on. */
    public synchronized void backlog(boolean waiting, long nowNs) {
        if (this.waiting) {
            busyNs += nowNs - sinceNs;
        }
        this.waiting = waiting;
        sinceNs = nowNs;
    }

    /** Records an opened delivery and updates the stratum mean bytes per band. */
    public synchronized void opened(int stratum, int bands, long bytes) {
        openedBytes += bytes;
        if (bands > 0 && stratum >= 0 && stratum < bandBytes.length) {
            bandBytes[stratum] += MEAN_GAIN * ((double) bytes / bands - bandBytes[stratum]);
        }
    }

    /** Returns the mean bytes per band for the given stratum. */
    public synchronized double bandBytes(int stratum) {
        return bandBytes[stratum];
    }

    /**
     * Closes a tick and returns the capacity in bytes per second,
     * or UNBOUNDED when the Painter was busy less than half of it.
     */
    public synchronized long sample(long nowNs) {
        backlog(waiting, nowNs);
        long tickLength = tickStartNs < 0 ? 0 : nowNs - tickStartNs;
        tickStartNs = nowNs;
        long busy = busyNs;
        long bytes = openedBytes;
        busyNs = 0;
        openedBytes = 0;
        if (tickLength <= 0 || busy < SATURATED * tickLength) {
            return UNBOUNDED;
        }
        samples[next] = (long) ((double) bytes * Units.NANOS_PER_S / busy);
        next = (next + 1) % SAMPLES;
        count = Math.min(count + 1, SAMPLES);
        long[] copy = Arrays.copyOf(samples, count);
        Arrays.sort(copy);
        return copy[count / 2];
    }
}
