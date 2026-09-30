package seurat.plan;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.proto.MsgGaze;
import seurat.concession.Concession;

/** §2.3 golden: 153 brushes / 212 deliveries + monotone ancestor-closed. */
public final class ConePlannerTest {
    static final int WIDTH = 196608;
    static final int HEIGHT = 163840;

    public static void main(String[] args) {
        golden();
        sketch();
        System.out.println("ConePlannerTest OK");
    }

    static Map<BrushId, Integer> sketchBook() {
        Map<BrushId, Integer> held = new HashMap<>();
        held.put(new BrushId(10, 0, 0), 4);
        for (int bx = 0; bx < 2; bx++) {
            for (int by = 0; by < 2; by++) {
                held.put(new BrushId(9, bx, by), 4);
            }
        }
        for (int bx = 0; bx < 3; bx++) {
            for (int by = 0; by < 3; by++) {
                held.put(new BrushId(8, bx, by), 4);
            }
        }
        for (int bx = 0; bx < 6; bx++) {
            for (int by = 0; by < 5; by++) {
                held.put(new BrushId(7, bx, by), 4);
            }
        }
        return held;
    }

    private static void golden() {
        var gaze = new MsgGaze.Gaze(1, 8, 65536, 49152, 69376, 51312, 1920, 1080, 0);
        var concession = new Concession(2, 0, 2, 1, 768, 36864, 120);
        Map<BrushId, Integer> held = sketchBook();
        var meta = new seurat.store.WorkMeta("slide-0421", "s", WIDTH, HEIGHT, 256, 11,
                3, 2, 0, 2);
        var out = ConePlanner.plan(gaze, concession, p -> held.getOrDefault(p, 0),
                meta, 1.0, 0);
        TestKit.check(out.throttle() == 0, "no regulation");
        TestKit.check(out.entries().size() == 212, "212 deliveries, got "
                + out.entries().size());
        Set<BrushId> brushes = new HashSet<>();
        for (PlanEntry e : out.entries()) {
            brushes.add(e.brush());
        }
        TestKit.check(brushes.size() == 153, "153 brushes, got " + brushes.size());
        Map<Integer, Integer> perStratum = new HashMap<>();
        for (BrushId b : brushes) {
            perStratum.merge(b.stratum(), 1, Integer::sum);
        }
        TestKit.check(perStratum.get(1) == 40, "s1 focus 40");
        TestKit.check(perStratum.get(2) == 48, "s2 48");
        TestKit.check(perStratum.get(3) == 40, "s3 40");
        TestKit.check(perStratum.get(4) == 15, "s4 15");
        TestKit.check(perStratum.get(5) == 6, "s5 6");
        TestKit.check(perStratum.get(6) == 4, "s6 4");
        monotone(out.entries(), held);
    }

    /** Applying entries in order never leaves a child denser than its parent. */
    static void monotone(java.util.List<PlanEntry> entries, Map<BrushId, Integer> held) {
        Map<BrushId, Integer> have = new HashMap<>(held);
        for (PlanEntry e : entries) {
            BrushId brush = e.brush();
            if (brush.stratum() < 10) {
                int parentBands = have.getOrDefault(brush.parent(), 0);
                TestKit.check(parentBands >= e.through(), "monotone " + brush
                        + " [" + e.from() + "," + e.through() + ") parent has "
                        + parentBands);
            }
            have.merge(brush, e.through(), Math::max);
        }
        for (BrushId brush : new HashSet<>(have.keySet())) {
            if (brush.stratum() < 10 && have.getOrDefault(brush, 0) > 0) {
                TestKit.check(have.getOrDefault(brush.parent(), 0) >= have.get(brush),
                        "ancestor-closed " + brush);
            }
        }
    }

    private static void sketch() {
        var meta = new seurat.store.WorkMeta("w", "w", 512, 384, 256, 2, 3, 2, 0, 2);
        Map<BrushId, Integer> held = new HashMap<>();
        var entries = ConeTiling.sketch(meta, 0, p -> held.getOrDefault(p, 0));
        TestKit.check(entries.size() == 1 + 4, "seed + four s0 brushes, got "
                + entries.size());
        TestKit.check(entries.get(0).brush().stratum() == 10, "seed first");
    }
}
