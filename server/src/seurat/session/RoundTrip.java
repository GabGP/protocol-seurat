package seurat.session;

import seurat.config.SeuratConstants;

/**
 * Spec 8: the server's margin on every lease is delta = max(1 s, 2 RTT). The RTT is measured
 * LATIDO -> ECO: the nonce is the LATIDO's send time on this JVM's monotonic clock. The longest
 * round trip seen is kept, since a larger delta only makes the book outlive the client longer.
 */
public final class RoundTrip {
    private static final long S = 1_000_000_000L;
    private volatile long rttNs;

    /** An ECO arrived at {@code nowNs} for a LATIDO sent at {@code sentNs}. */
    public void sample(long sentNs, long nowNs) {
        long rtt = nowNs - sentNs;
        if (rtt > 0 && rtt < SeuratConstants.HEARTBEAT_MISSES * SeuratConstants.HEARTBEAT_S * S) {
            rttNs = Math.max(rttNs, rtt); // a nonce that is not one of ours is no sample
        }
    }

    public long deltaNs() {
        return Math.max(SeuratConstants.SKEW_MS * 1_000_000L, 2 * rttNs);
    }
}
