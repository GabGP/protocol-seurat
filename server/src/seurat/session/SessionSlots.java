package seurat.session;

import java.util.concurrent.atomic.AtomicInteger;
import seurat.config.SeuratConstants;

/** Flow slots of one session, sized by the receiver's queue (spec 6.1): green, amber halves, red stops. */
final class SessionSlots {
    private final AtomicInteger inFlight = new AtomicInteger();
    private volatile long queueMs;
    /** Red receiver (cola_ms > 400): nothing new opens until it drops below 150 (spec 6.1). */
    private volatile boolean red;

    /** RECIBO.cola_ms: amber halves max_en_vuelo, red stops new flows with hysteresis. */
    void queue(long ms) {
        queueMs = ms;
        if (ms > SeuratConstants.QUEUE_RED_MS) {
            red = true;
        } else if (ms < SeuratConstants.QUEUE_AMBER_MS) {
            red = false;
        }
    }

    long queueMs() {
        return queueMs;
    }

    /** max_en_vuelo for this instant: 12, halved while the receiver is amber (spec 6.1). */
    int limit() {
        return queueMs >= SeuratConstants.QUEUE_AMBER_MS ? SeuratConstants.MAX_IN_FLIGHT / 2
                : SeuratConstants.MAX_IN_FLIGHT;
    }

    boolean hasRoom() {
        return !red && inFlight.get() < limit();
    }

    boolean take() {
        for (;;) {
            int n = inFlight.get();
            if (n >= limit()) {
                return false;
            }
            if (inFlight.compareAndSet(n, n + 1)) {
                return true;
            }
        }
    }

    void release() {
        inFlight.decrementAndGet();
    }

    int inFlight() {
        return inFlight.get();
    }
}
