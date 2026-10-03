package seurat.core.viewing.session;

import java.util.List;
import java.util.Map;
import seurat.kit.TestKit;

/** ADR-07 rules 3-4: tiers fill coarsest first; inside the tier that does not fit, whole demands by rank. */
public final class AllotmentTest {
    /** Rank by key name: "A" goes first. */
    private static final Allotment.Rank<String> BY_NAME = (k, tier, wanted) -> k.charAt(0);

    public static void main(String[] args) {
        unboundedRoom();
        everythingFits();
        ringsDoNotFit();
        coreDoesNotFit();
        rankDecides();
        smallerOneStillFits();
        emptyDemand();
        System.out.println("AllotmentTest OK");
    }

    private static void check(Allotment.Grant g, int tier, long bytes, String what) {
        TestKit.check(g.tier() == tier && g.bytes() == bytes, what + ": got tier " + g.tier() + " bytes " + g.bytes());
    }

    private static void unboundedRoom() {
        var grants = Allotment.fill(Map.of("A", new long[] {10, 20, 30}, "B", new long[] {40, 50, 60}),
                CapacityMeter.UNBOUNDED, BY_NAME);
        check(grants.get("A"), 3, CapacityMeter.UNBOUNDED, "A unbounded");
        check(grants.get("B"), 3, CapacityMeter.UNBOUNDED, "B unbounded");
    }

    private static void everythingFits() {
        var grants = Allotment.fill(Map.of("A", new long[] {10, 20, 30}, "B", new long[] {10, 20, 30}), 1000, BY_NAME);
        check(grants.get("A"), 3, 60, "A fits");
        check(grants.get("B"), 3, 60, "B fits");
    }

    /** Tiers 1-2 take 40 of 100; A's rings (100) do not fit in 60 and are cut, B's (10) do. */
    private static void ringsDoNotFit() {
        var grants = Allotment.fill(Map.of("A", new long[] {10, 10, 100}, "B", new long[] {10, 10, 10}), 100, BY_NAME);
        check(grants.get("A"), 2, 20, "A cut at the rings");
        check(grants.get("B"), 3, 30, "B whole");
    }

    /** No partial share: what is cut gets nothing of that tier; a key with no core demand keeps tier 1. */
    private static void coreDoesNotFit() {
        var grants = Allotment.fill(Map.of(
                "A", new long[] {100, 0, 0}, "B", new long[] {30, 0, 0}, "C", new long[] {0, 0, 50}), 90, BY_NAME);
        check(grants.get("A"), 0, 0, "A's core does not fit");
        check(grants.get("B"), 1, 30, "B's core does");
        check(grants.get("C"), 1, 0, "C wanted no core; the filling stops at tier 1");
    }

    /** Equal demands: the rank decides who goes first, and the room is never exceeded. */
    private static void rankDecides() {
        var grants = Allotment.fill(Map.of("A", new long[] {100, 0, 0}, "B", new long[] {100, 0, 0},
                "C", new long[] {100, 0, 0}, "D", new long[] {100, 0, 0}), 200, BY_NAME);
        check(grants.get("A"), 1, 100, "A first");
        check(grants.get("B"), 1, 100, "B second");
        check(grants.get("C"), 0, 0, "C cut");
        check(grants.get("D"), 0, 0, "D cut");
        long total = 0;
        for (String k : List.of("A", "B", "C", "D")) {
            total += grants.get(k).bytes();
        }
        TestKit.check(total <= 200, "the room is never exceeded");
    }

    /** First fit: a later, smaller demand still takes the room an earlier one could not use. */
    private static void smallerOneStillFits() {
        var grants = Allotment.fill(Map.of("A", new long[] {80, 0, 0}, "B", new long[] {20, 0, 0}), 50, BY_NAME);
        check(grants.get("A"), 0, 0, "A does not fit");
        check(grants.get("B"), 1, 20, "B does");
    }

    private static void emptyDemand() {
        var grants = Allotment.fill(Map.of("A", new long[] {0, 0, 0}), 100, BY_NAME);
        check(grants.get("A"), 3, 0, "empty demand");
    }
}
