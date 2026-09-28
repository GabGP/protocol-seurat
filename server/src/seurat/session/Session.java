package seurat.session;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import seurat.config.SeuratConstants;
import seurat.net.Mapping;

/** Per-connection state. Its Easel writes the protocol state; the Painter reads the gates. */
public final class Session {
    private final long id;
    private final String principal;
    private final String role;
    private final long memMib;
    private final long caps;
    private final Mapping mapping;
    private final Map<Long, Canvas> canvases = new ConcurrentHashMap<>();
    private final AtomicLong nextHandle = new AtomicLong();
    private final AtomicInteger inFlight = new AtomicInteger();
    public final SessionRate rate;
    public volatile byte[] ticket;
    /** Session this one resumed; its ticket stays valid until our first RECIBO (spec 8). */
    public volatile long resumedFrom;
    public volatile double alpha;
    public volatile double share = 1.0;
    public volatile long tickDeliveries;
    public volatile long tickMarked;
    public volatile double stride;
    public volatile long lastGazeNs;
    public volatile long lastEchoNs = System.nanoTime();
    /** LATIDO -> ECO, for delta = max(1 s, 2 RTT) (spec 8). */
    public final RoundTrip roundTrip = new RoundTrip();
    public volatile long queueMs;
    /** Red receiver (cola_ms > 400): nothing new opens until it drops below 150 (spec 6.1). */
    public volatile boolean red;

    public Session(long id, String principal, String role, long memMib, long caps,
            Mapping mapping, byte[] ticket, long rateBytesPerS) {
        this.id = id;
        this.principal = principal;
        this.role = role;
        this.memMib = memMib;
        this.caps = caps;
        this.mapping = mapping;
        this.ticket = ticket;
        this.rate = new SessionRate(rateBytesPerS);
    }

    /** No byte-rate limit (tests, tools). */
    public Session(long id, String principal, String role, long memMib, long caps, Mapping mapping, byte[] ticket) {
        this(id, principal, role, memMib, caps, mapping, ticket, 0);
    }

    public long id() {
        return id;
    }

    public String principal() {
        return principal;
    }

    public String role() {
        return role;
    }

    public long memMib() {
        return memMib;
    }

    public long caps() {
        return caps;
    }

    public Mapping mapping() {
        return mapping;
    }

    public byte[] ticket() {
        return ticket;
    }

    public void ticket(byte[] value) {
        ticket = value;
    }

    public Map<Long, Canvas> canvases() {
        return canvases;
    }

    public long newHandle() {
        return nextHandle.incrementAndGet();
    }

    /** Adopted canvases must not be reused by later ABRIR (resume safety). */
    public void claimHandle(long handle) {
        nextHandle.accumulateAndGet(handle, Math::max);
    }

    /** RECIBO.cola_ms: amber halves max_en_vuelo, red stops new flows with hysteresis. */
    public void queue(long ms) {
        queueMs = ms;
        if (ms > SeuratConstants.QUEUE_RED_MS) {
            red = true;
        } else if (ms < SeuratConstants.QUEUE_AMBER_MS) {
            red = false;
        }
    }

    /** max_en_vuelo for this instant: 12, halved while the receiver is amber (spec 6.1). */
    public int slotLimit() {
        return queueMs >= SeuratConstants.QUEUE_AMBER_MS ? SeuratConstants.MAX_IN_FLIGHT / 2
                : SeuratConstants.MAX_IN_FLIGHT;
    }

    public boolean canOpen() {
        return !red && inFlight.get() < slotLimit() && rate.ready();
    }

    public boolean takeSlot() {
        for (;;) {
            int n = inFlight.get();
            if (n >= slotLimit()) {
                return false;
            }
            if (inFlight.compareAndSet(n, n + 1)) {
                return true;
            }
        }
    }

    public void releaseSlot() {
        inFlight.decrementAndGet();
    }

    public int inFlight() {
        return inFlight.get();
    }
}
