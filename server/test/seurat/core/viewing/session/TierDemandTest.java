package seurat.core.viewing.session;

import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.viewing.plan.PlanEntry;
import seurat.kit.TestKit;

/** ADR-07 rule 2: demand is the rate of new want by tier, smoothed over ticks. */
public final class TierDemandTest {
    public static void main(String[] args) {
        newGazeArrivesWhole();
        replanAddsOnlyGrowth();
        rateDecays();
        clearForgets();
        estimate();
        System.out.println("TierDemandTest OK");
    }

    private static long[] rate(TierDemand td) {
        long[] sum = new long[Allotment.TIERS];
        td.addTo(sum);
        return sum;
    }

    /** 4000 bytes in a 0.25 s tick is 16000 B/s; a quarter of it enters the rate. */
    private static void newGazeArrivesWhole() {
        TierDemand td = new TierDemand();
        td.plan(new long[] {4000, 0, 400}, true);
        TestKit.check(rate(td)[0] == 0, "nothing counts before the tick closes");
        td.tick(0.25);
        long[] r = rate(td);
        TestKit.check(r[0] == 4000 && r[1] == 0 && r[2] == 400, "rate after one tick, got " + r[0] + "," + r[2]);
    }

    /** A replan of the same MIRADA brings only what exceeds what the live plan still wants. */
    private static void replanAddsOnlyGrowth() {
        TierDemand td = new TierDemand();
        td.plan(new long[] {4000, 0, 0}, true);
        td.opened(1, 1000);
        td.opened(0, 5);
        td.opened(4, 5);
        td.tick(0.25);
        td.plan(new long[] {3000, 0, 0}, false);
        td.tick(0.25);
        TestKit.check(rate(td)[0] == 3000, "the same want again adds nothing: 4000 then 3/4 of it");
        td.plan(new long[] {7000, 0, 0}, false);
        td.tick(0.25);
        TestKit.check(rate(td)[0] == 2250 + 4000, "only the 4000 B of growth arrive");
        td.plan(new long[] {7000, 0, 0}, true);
        td.tick(0.25);
        TestKit.check(rate(td)[0] > 6250, "a new MIRADA brings its whole cone");
    }

    private static void rateDecays() {
        TierDemand td = new TierDemand();
        td.plan(new long[] {4000, 0, 0}, true);
        td.tick(0.25);
        for (int i = 0; i < 16; i++) {
            td.tick(0.25);
        }
        TestKit.check(rate(td)[0] < 50, "4 s without new want: the rate fades");
    }

    private static void clearForgets() {
        TierDemand td = new TierDemand();
        td.plan(new long[] {4000, 4000, 4000}, true);
        td.tick(0.25);
        td.clear();
        td.tick(0.25);
        long[] r = rate(td);
        TestKit.check(r[0] == 0 && r[1] == 0 && r[2] == 0, "a hidden canvas wants nothing");
    }

    private static void estimate() {
        List<PlanEntry> entries = List.of(
                new PlanEntry(new BrushId(1, 0, 0), 0, 2, 1),
                new PlanEntry(new BrushId(2, 0, 0), 1, 4, 3));
        long[] estimated = TierDemand.estimate(entries, new CapacityMeter());
        TestKit.check(estimated[0] == 16384L && estimated[1] == 0L && estimated[2] == 24576L,
                "fresh capacity meter estimates demand by tier");
    }
}
