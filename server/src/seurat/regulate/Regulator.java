package seurat.regulate;

import java.util.Collection;
import seurat.config.SeuratConstants;
import seurat.session.Session;

/** CoDel over the Painter queue + per-session DCTCP response. */
public final class Regulator {
    /** DCTCP gain g = 1/16 for the marked-fraction average alpha. */
    private static final double ALPHA_GAIN = 1.0 / 16;
    /** Share never drops below 1/8 of the base rate, never rises above the full rate, and recovers 1/32 per tick. */
    private static final double SHARE_MIN = 0.125;
    private static final double SHARE_MAX = 1.0;
    private static final double SHARE_STEP = 1.0 / 32;
    private long minDwell = Long.MAX_VALUE;
    private volatile boolean congested;

    public synchronized void onStart(Session session, long dwellNs) {
        minDwell = Math.min(minDwell, dwellNs);
        session.tickDeliveries++;
        if (congested) {
            session.tickMarked++;
        }
    }

    /** Every 250ms: persistent queue (min dwell > 25ms) means congestion. */
    public synchronized void tick(Collection<Session> sessions) {
        congested = minDwell != Long.MAX_VALUE
                && minDwell > SeuratConstants.CODEL_TARGET_NS;
        minDwell = Long.MAX_VALUE;
        for (Session session : sessions) {
            double f = session.tickDeliveries == 0 ? 0 : (double) session.tickMarked / session.tickDeliveries;
            session.alpha = (1 - ALPHA_GAIN) * session.alpha + f * ALPHA_GAIN;
            session.share = f > 0 ? Math.max(SHARE_MIN, session.share * (1 - session.alpha / 2))
                    : Math.min(SHARE_MAX, session.share + SHARE_STEP);
            session.tickDeliveries = 0;
            session.tickMarked = 0;
        }
    }

    public boolean congested() {
        return congested;
    }
}
