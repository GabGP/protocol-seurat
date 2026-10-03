package seurat.core.viewing.session;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/** Per-connection state. Its Easel writes the protocol state; the Painter reads the gates. */
public final class Session {
    private final long id;
    private final String principal;
    private final long memMib;
    private final long caps;
    private final Mapping mapping;
    private final Map<Long, Canvas> canvases = new ConcurrentHashMap<>();
    private final AtomicLong nextHandle = new AtomicLong();
    private final SessionSlots slots = new SessionSlots();
    public final SessionRate rate;
    public volatile byte[] ticket;
    /** Session this one resumed; its ticket stays valid until our first RECIBO (spec 8). */
    public volatile long resumedFrom;
    public volatile double alpha;
    public volatile double share = 1.0;
    /** Spec 6.3 load rung the planner cuts the cone to: 3 normal, 2 no ring 2, 1 focus up to 2 bands, 0 focus one stratum coarser. */
    public volatile int rung = 3;
    public volatile long tickDeliveries;
    public volatile long tickMarked;
    public volatile double stride;
    public volatile long lastGazeNs;
    public volatile long lastEchoNs = System.nanoTime();
    /** LATIDO -> ECO, for delta = max(1 s, 2 RTT) (spec 8). */
    public final RoundTrip roundTrip = new RoundTrip();

    public Session(long id, String principal, long memMib, long caps,
            Mapping mapping, byte[] ticket, long rateBytesPerS) {
        this.id = id;
        this.principal = principal;
        this.memMib = memMib;
        this.caps = caps;
        this.mapping = mapping;
        this.ticket = ticket;
        this.rate = new SessionRate(rateBytesPerS);
    }

    /** No byte-rate limit (tests, tools). */
    public Session(long id, String principal, long memMib, long caps, Mapping mapping, byte[] ticket) {
        this(id, principal, memMib, caps, mapping, ticket, 0);
    }

    public long id() {
        return id;
    }

    public String principal() {
        return principal;
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
        slots.queue(ms);
    }

    public long queueMs() {
        return slots.queueMs();
    }

    public boolean canOpen() {
        return slots.hasRoom() && rate.ready();
    }

    public boolean takeSlot() {
        return slots.take();
    }

    public void releaseSlot() {
        slots.release();
    }

    public int inFlight() {
        return slots.inFlight();
    }
}
