package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * ADR-07 tiered sharpness filling. Every tick it measures the capacity in busy time, sums each
 * session's demand by tier, allots the next horizon coarsest tier first, and moves each session's
 * rung, which drops at once and climbs after 2 ticks.
 */
public final class Regulator {
    /** The allotment covers the next second (ADR-07 H). */
    private static final int HORIZON_S = 1;
    /** A session climbs only after a higher tier fit this many ticks in a row. */
    private static final int RISE_TICKS = 2;

    private final CapacityMeter meter = new CapacityMeter();

    public CapacityMeter meter() {
        return meter;
    }

    /**
     * The server tick. Every session's demand is summed over its canvases.
     * Returns the sessions whose rung rose.
     */
    public List<Session> tick(Collection<Session> sessions, long nowNs) {
        Map<Session, long[]> demand = new HashMap<>();
        for (Session session : sessions) {
            long[] sum = new long[Allotment.TIERS];
            for (Canvas canvas : session.canvases().values()) {
                canvas.plan().demand().addTo(sum);
            }
            demand.put(session, sum);
        }
        return tick(demand, nowNs);
    }

    /** Allots capacity across tiers and settles session rungs. */
    public List<Session> tick(Map<Session, long[]> demand, long nowNs) {
        long capacity = meter.sample(nowNs);
        long room = capacity == CapacityMeter.UNBOUNDED ? CapacityMeter.UNBOUNDED : capacity * HORIZON_S;
        List<Session> rose = new ArrayList<>();
        for (Map.Entry<Session, Allotment.Grant> entry : Allotment.fill(demand, room).entrySet()) {
            if (settle(entry.getKey(), entry.getValue().tier())) {
                rose.add(entry.getKey());
            }
        }
        return rose;
    }

    /**
     * ADR-07 rule 5. The rung drops at once; it climbs after RISE_TICKS ticks in a row
     * above it, to the lowest tier granted in them. Returns true when it rose.
     */
    static boolean settle(Session s, int granted) {
        if (granted < s.rung) {
            s.rung = granted;
            s.rise = 0;
            return false;
        }
        if (granted == s.rung) {
            s.rise = 0;
            return false;
        }
        s.riseTo = s.rise == 0 ? granted : Math.min(s.riseTo, granted);
        s.rise++;
        if (s.rise < RISE_TICKS) {
            return false;
        }
        s.rung = s.riseTo;
        s.rise = 0;
        return true;
    }
}
