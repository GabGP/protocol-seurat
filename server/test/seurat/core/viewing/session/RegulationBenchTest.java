package seurat.core.viewing.session;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import seurat.kit.TestKit;
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
            Result none = run(Unregulated::new, cap);
            print(none, cap);
            Result built = run(() -> new LegacyRegulation(false), cap);
            Result sojourn = run(() -> new LegacyRegulation(true), cap);
            Result tiered = run(TieredRegulation::new, cap);
            print(built, cap);
            print(sojourn, cap);
            print(tiered, cap);
            gate(tiered.stats(), built.stats(), tiered.viewers());
            gate(tiered.stats(), sojourn.stats(), tiered.viewers());
            // Every byte here is a wanted plan entry: regulation only withholds, it never adds payload.
            TestKit.check(tiered.stats().totalBytes() <= none.stats().totalBytes(), "no payload beyond the unregulated run");
        }
        // 24 MiB/s: the 4-viewer phases fit, so every viewer is back at the normal cone within 500 ms.
        TestKit.check(run(TieredRegulation::new, CAPS[0]).stats().coneBackMs() <= 500, "back at rung 3 within 500 ms");
        System.out.println("RegulationBench OK");
    }

    /** ADR-07 gate in the load step (phase 1): fair, shorter queues, more cores done. */
    private static void gate(RegulationStats t, RegulationStats v1, List<RegulationViewer> viewers) {
        TestKit.check(t.jain(1, viewers) >= 0.9, "Jain >= 0.9 in the step");
        TestKit.check(t.p95DwellMs(1) <= v1.p95DwellMs(1), "p95 queue dwell <= v1.0");
        TestKit.check(t.coreDone(1) >= v1.coreDone(1), "at least as many cores completed as v1.0");
    }

    record Result(String arm, RegulationStats stats, List<RegulationViewer> viewers, long controlBytes) {}

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
        return new Result(a.name(), stats, viewers, a.controlBytes());
    }

    static void print(Result r, long cap) {
        RegulationStats s = r.stats();
        System.out.printf("RegulationBench %-18s jain(step)=%.3f util=%.2f/%.2f/%.2f core-util=%.2f/%.2f/%.2f p95dwell=%d/%d/%dms"
                + " p95core=%d/%d/%dms core=%d/%d/%d censored=%d/%d/%d rungChanges/viewer-min=%.1f"
                + " rungBack=%dms coneBack=%dms bytes=%d control=%d%n",
                r.arm(), s.jain(1, r.viewers()),
                s.utilization(0, cap), s.utilization(1, cap), s.utilization(2, cap),
                s.coreUtilization(0, cap), s.coreUtilization(1, cap), s.coreUtilization(2, cap),
                s.p95DwellMs(0), s.p95DwellMs(1), s.p95DwellMs(2),
                s.p95CoreMs(0), s.p95CoreMs(1), s.p95CoreMs(2),
                s.coreDone(0), s.coreDone(1), s.coreDone(2),
                s.censored(0), s.censored(1), s.censored(2),
                s.rungChangesPerViewerMinute(r.viewers()), s.rungBackMs(), s.coneBackMs(), s.totalBytes(), r.controlBytes());
    }

    /** Reference: no regulation, every plan at rung 3. */
    private static final class Unregulated implements RegulationSim.Arm {
        @Override
        public String name() {
            return "unregulated";
        }

        @Override
        public void planned(RegulationViewer v, List<PlanEntry> full, boolean newGaze) {}

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
