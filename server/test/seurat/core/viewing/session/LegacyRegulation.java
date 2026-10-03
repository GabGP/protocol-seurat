package seurat.core.viewing.session;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import seurat.core.viewing.plan.PlanEntry;

/**
 * The bench baseline only: Seurat/1 v1.0 §6.3 as the server ran it before ADR-07 (CoDel dwell
 * signal, DCTCP response, AIMD share, the share staircase). Kept here so the comparison stays
 * runnable; the server no longer contains it.
 */
final class LegacyRegulation implements RegulationSim.Arm {
    private static final long TARGET_NS = 25 * RegulationSim.MS;
    private static final double ALPHA_GAIN = 1.0 / 16;
    private static final double SHARE_MIN = 0.125;
    private static final double SHARE_STEP = 1.0 / 32;

    /** alpha, share, deliveries this tick, marked this tick. */
    private final Map<RegulationViewer, double[]> state = new HashMap<>();
    /** false: dwell from "lista", as the server measured it; true: CoDel's usual sojourn, from PLAN INICIO. */
    private final boolean sojourn;
    private long minDwell = Long.MAX_VALUE;
    private boolean congested;

    LegacyRegulation(boolean sojourn) {
        this.sojourn = sojourn;
    }

    private double[] of(RegulationViewer v) {
        return state.computeIfAbsent(v, k -> new double[] {0, 1, 0, 0});
    }

    @Override
    public String name() {
        return sojourn ? "v1.0 (sojourn)" : "v1.0 (as built)";
    }

    @Override
    public void planned(RegulationViewer v, List<PlanEntry> full) {}

    @Override
    public void opened(RegulationViewer v, PlanEntry e, long bytes, long dwellNs, long sojournNs) {
        minDwell = Math.min(minDwell, sojourn ? sojournNs : dwellNs);
        double[] s = of(v);
        s[2]++;
        if (congested) {
            s[3]++;
        }
    }

    @Override
    public void backlog(boolean waiting, long nowNs) {}

    @Override
    public void tick(List<RegulationViewer> active, long nowNs) {
        congested = minDwell != Long.MAX_VALUE && minDwell > TARGET_NS;
        minDwell = Long.MAX_VALUE;
        for (RegulationViewer v : active) {
            double[] s = of(v);
            double f = s[2] == 0 ? 0 : s[3] / s[2];
            s[0] = (1 - ALPHA_GAIN) * s[0] + f * ALPHA_GAIN;
            s[1] = f > 0 ? Math.max(SHARE_MIN, s[1] * (1 - s[0] / 2)) : Math.min(1, s[1] + SHARE_STEP);
            s[2] = 0;
            s[3] = 0;
            v.rung = s[1] >= 0.75 ? 3 : s[1] >= 0.5 ? 2 : s[1] >= 0.25 ? 1 : 0;
        }
    }

    @Override
    public boolean replansOnRise() {
        return false;
    }
}
