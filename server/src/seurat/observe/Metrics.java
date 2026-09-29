package seurat.observe;

import java.util.concurrent.atomic.LongAdder;

/** Served-traffic counters. */
public final class Metrics {
    public final LongAdder deliveries = new LongAdder();
    public final LongAdder bytes = new LongAdder();
}
