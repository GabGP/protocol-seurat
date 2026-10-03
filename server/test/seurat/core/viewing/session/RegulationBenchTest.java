package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import seurat.core.viewing.plan.PlanEntry;

/**
 * ADR-07 evidence: regulation arms on the same world. 4 viewers pan the slide for 10 s, 12 more
 * join for 10 s (load step up), then leave (step down) for 10 s. One Painter of fixed capacity.
 */
public final class RegulationBenchTest {
    private static final long S = 1000 * RegulationSim.MS;
    /** The Painter's capacity: the 4-viewer phases fit (30 % busy), the step does not; and a heavy case. */
    private static final long[] CAPS = {24L << 20, 6L << 20};
    private static final int BASE = 4;
    private static final int STEP = 12;

    public static void main(String[] args) {
        for (long cap : CAPS) {
            System.out.println("RegulationBench capacity " + (cap >> 20) + " MiB/s");
            print(run(Unregulated::new, cap), cap);
            print(run(() -> new LegacyRegulation(false), cap), cap);
            print(run(() -> new LegacyRegulation(true), cap), cap);
        }
        System.out.println("RegulationBench OK");
    }

    record Result(String arm, RegulationStats stats, List<RegulationViewer> viewers) {}

    static Result run(Supplier<RegulationSim.Arm> arm, long cap) {
        List<RegulationViewer> viewers = new ArrayList<>();
        for (int i = 0; i < BASE; i++) {
            viewers.add(new RegulationViewer(i, 0, 30 * S));
        }
        for (int i = BASE; i < BASE + STEP; i++) {
            viewers.add(new RegulationViewer(i, 10 * S, 20 * S));
        }
        RegulationStats stats = new RegulationStats(0, 10 * S, 20 * S, 30 * S);
        RegulationSim.Arm a = arm.get();
        new RegulationSim(a, viewers, cap, stats).run(30 * S);
        return new Result(a.name(), stats, viewers);
    }

    static void print(Result r, long cap) {
        RegulationStats s = r.stats();
        System.out.printf("RegulationBench %-18s jain(step)=%.3f util=%.2f/%.2f/%.2f p95dwell=%d/%d/%dms"
                + " p95core=%d/%d/%dms core=%d/%d/%d censored=%d/%d/%d rungChanges/viewer-min=%.1f"
                + " rungBack=%dms coneBack=%dms bytes=%d%n",
                r.arm(), s.jain(1, r.viewers()),
                s.utilization(0, cap), s.utilization(1, cap), s.utilization(2, cap),
                s.p95DwellMs(0), s.p95DwellMs(1), s.p95DwellMs(2),
                s.p95CoreMs(0), s.p95CoreMs(1), s.p95CoreMs(2),
                s.coreDone(0), s.coreDone(1), s.coreDone(2),
                s.censored(0), s.censored(1), s.censored(2),
                s.rungChangesPerViewerMinute(r.viewers()), s.rungBackMs(), s.coneBackMs(), s.totalBytes());
    }

    /** Reference: no regulation, every plan at rung 3. */
    private static final class Unregulated implements RegulationSim.Arm {
        @Override
        public String name() {
            return "unregulated";
        }

        @Override
        public void planned(RegulationViewer v, List<PlanEntry> full) {}

        @Override
        public void opened(RegulationViewer v, PlanEntry e, long bytes, long dwellNs, long sojournNs) {}

        @Override
        public void backlog(boolean waiting, long nowNs) {}

        @Override
        public void tick(List<RegulationViewer> active, long nowNs) {}

        @Override
        public boolean replansOnRise() {
            return false;
        }
    }
}
