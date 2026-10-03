package seurat.core.viewing.session;

import java.util.List;
import java.util.Map;
import seurat.kit.TestKit;

/** Tests for {@link Allotment}. */
public final class AllotmentTest {
    public static void main(String[] args) {
        unboundedRoom();
        everythingFits();
        ringsDoNotFit();
        coreDoesNotFit();
        fairness();
        emptyDemand();
        System.out.println("AllotmentTest OK");
    }

    private static void unboundedRoom() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {10, 20, 30},
            "B", new long[] {40, 50, 60}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, CapacityMeter.UNBOUNDED);
        TestKit.check(grants.get("A").tier() == Allotment.TIERS
                && grants.get("A").bytes() == CapacityMeter.UNBOUNDED, "A unbounded");
        TestKit.check(grants.get("B").tier() == Allotment.TIERS
                && grants.get("B").bytes() == CapacityMeter.UNBOUNDED, "B unbounded");
    }

    private static void everythingFits() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {10, 20, 30},
            "B", new long[] {10, 20, 30}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, 1000L);
        TestKit.check(grants.get("A").tier() == Allotment.TIERS
                && grants.get("A").bytes() == 60L, "A fits tier 3");
        TestKit.check(grants.get("B").tier() == Allotment.TIERS
                && grants.get("B").bytes() == 60L, "B fits tier 3");
    }

    private static void ringsDoNotFit() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {10, 10, 100},
            "B", new long[] {10, 10, 10}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, 100L);
        TestKit.check(grants.get("A").tier() == 2 && grants.get("A").bytes() == 70L, "A tier 2, 70B");
        TestKit.check(grants.get("B").tier() == 3 && grants.get("B").bytes() == 30L, "B tier 3, 30B");
    }

    private static void coreDoesNotFit() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {100, 0, 0},
            "B", new long[] {30, 0, 0},
            "C", new long[] {0, 0, 50}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, 90L);
        TestKit.check(grants.get("A").tier() == 0 && grants.get("A").bytes() == 60L, "A tier 0, 60B");
        TestKit.check(grants.get("B").tier() == 1 && grants.get("B").bytes() == 30L, "B tier 1, 30B");
        TestKit.check(grants.get("C").tier() == 1 && grants.get("C").bytes() == 0L, "C tier 1, 0B");
        long total = grants.get("A").bytes() + grants.get("B").bytes() + grants.get("C").bytes();
        TestKit.check(total <= 90L, "total does not exceed room: " + total);
    }

    private static void fairness() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {100, 0, 0},
            "B", new long[] {100, 0, 0},
            "C", new long[] {100, 0, 0},
            "D", new long[] {100, 0, 0}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, 200L);
        for (String k : List.of("A", "B", "C", "D")) {
            TestKit.check(grants.get(k).tier() == 0 && grants.get(k).bytes() == 50L,
                    k + " gets 50 at tier 0");
        }
    }

    private static void emptyDemand() {
        Map<String, long[]> demand = Map.of(
            "A", new long[] {0, 0, 0}
        );
        Map<String, Allotment.Grant> grants = Allotment.fill(demand, 100L);
        TestKit.check(grants.get("A").tier() == Allotment.TIERS
                && grants.get("A").bytes() == 0L, "empty demand tier 3, 0B");
    }
}
