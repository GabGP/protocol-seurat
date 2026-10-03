package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import seurat.core.shared.config.Units;

/**
 * ADR-07 tiered sharpness filling. Every tick it measures the capacity in busy time, sums each
 * session's demand rate by tier, allots the capacity coarsest tier first, and moves each session's
 * rung, which drops at once and climbs after 2 ticks. Rates and capacity are both bytes per second.
 */
public final class Regulator {
    /** A session climbs only after a higher tier fit this many ticks in a row. */
    private static final int RISE_TICKS = 2;

    /** Seconds of a tier's demand an admitted session may be ahead (in stride) and keep its place. */
    private static final double STICKY_S = 4;
    /**
     * Inside the tier that does not fit, the session served least so far (spec 6.2 stride) goes
     * first; one already granted the tier keeps its place until it is STICKY_S of that tier ahead.
     */
    private static final Allotment.Rank<Session> LEAST_SERVED =
            (s, tier, wanted) -> s.stride - (s.rung > tier ? wanted * STICKY_S : 0);
    private final CapacityMeter meter = new CapacityMeter();
    /** Start of the tick being closed; -1 before the first. */
    private long lastTickNs = -1;

    public CapacityMeter meter() {
        return meter;
    }

    /**
     * The server tick. Each canvas folds its new want into its rate, and every session's rate is
     * summed over its canvases. Returns the sessions whose rung rose.
     */
    public List<Session> tick(Collection<Session> sessions, long nowNs) {
        double tickS = lastTickNs < 0 ? 0 : (double) (nowNs - lastTickNs) / Units.NANOS_PER_S;
        lastTickNs = nowNs;
        Map<Session, long[]> demand = new HashMap<>();
        for (Session session : sessions) {
            long[] sum = new long[Allotment.TIERS];
            for (Canvas canvas : session.canvases().values()) {
                if (tickS > 0) {
                    canvas.plan().demand().tick(tickS);
                }
                canvas.plan().demand().addTo(sum);
            }
            demand.put(session, sum);
        }
        return tick(demand, nowNs);
    }

    /** Allots the capacity to the demand rates (bytes per second by tier) and settles the rungs. */
    public List<Session> tick(Map<Session, long[]> demand, long nowNs) {
        List<Session> rose = new ArrayList<>();
        for (Map.Entry<Session, Allotment.Grant> entry : Allotment.fill(demand, meter.sample(nowNs), LEAST_SERVED).entrySet()) {
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
