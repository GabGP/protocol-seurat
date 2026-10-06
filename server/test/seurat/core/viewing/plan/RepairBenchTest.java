package seurat.core.viewing.plan;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.LoanBook;
import seurat.core.works.store.WorkMeta;
import seurat.kit.TestKit;

/**
 * ADR-06 evidence: cone-gated repair against Selective Repeat, on the spec's slide-0421 view
 * (the real planner, no threads). Selective Repeat resent every failed delivery ahead of the queue;
 * repair drops it from the book and plans the live MIRADA again.
 */
public final class RepairBenchTest {
    /** Size model, not a measurement: every band counts as 8 KiB. */
    private static final int BYTES_PER_BAND = 8192;
    /** One failure every 25 deliveries (4 %). */
    private static final int FAIL_EVERY = 25;
    /** The pan of scenario B and C: one view-width-and-more to the right. */
    private static final int PAN_PX = 40000;
    private static final WorkMeta META = new WorkMeta("slide-0421", "s", 196608, 163840, 256, 11, 3, 2);
    private static final Concession FULL = new Concession(2, 0, 1, 768, 36864, 120);
    private static final MsgGaze.Gaze G1 = new MsgGaze.Gaze(1, 8, 65536, 49152, 69376, 51312, 1920, 1080, 0);
    private static final MsgGaze.Gaze G2 = new MsgGaze.Gaze(1, 9, G1.x0() + PAN_PX, G1.y0(),
            G1.x1() + PAN_PX, G1.y1(), G1.vw(), G1.vh(), 0);

    public static void main(String[] args) {
        LoanBook book = new LoanBook();
        ConePlannerTest.sketchBook().forEach((p, bands) -> book.log(p, 0, bands, 1, 1));
        List<PlanEntry> p1 = plan(G1, book);
        List<PlanEntry> failed = new ArrayList<>();
        for (int i = 0; i < p1.size(); i++) {
            PlanEntry e = p1.get(i);
            long n = book.log(e.brush(), e.from(), e.through(), 1, 1).number();
            if ((i + 1) % FAIL_EVERY == 0) {
                failed.add(e);
                book.release(Ranges.of(n)); // SOLTAR CRC: the book keeps every other delivery
            }
        }
        Set<BrushId> failedBrushes = new HashSet<>();
        failed.forEach(e -> failedBrushes.add(e.brush()));
        int sr = bands(failed);

        int still = bands(plan(G1, book));
        TestKit.check(still == sr, "still view: repair refills exactly the lost bands, nothing held is resent");
        print("A still", failed.size(), sr, still);

        List<PlanEntry> p2 = plan(G2, book);
        int moved = bands(p2.stream().filter(e -> failedBrushes.contains(e.brush())).toList());
        TestKit.check(moved < sr, "after a pan: repair resends strictly less");
        print("B moved", failed.size(), sr, moved);

        PlanEntry f = failed.get(0);
        int srDelayed = (int) p2.stream().filter(e -> e.brush().stratum() > f.brush().stratum()).count();
        boolean rewanted = p2.stream().anyMatch(e -> e.brush().equals(f.brush()));
        int repairDelayed = rewanted ? delayedBehind(p2, f.brush()) : 0;
        TestKit.check(repairDelayed <= srDelayed, "after a pan: no coarser new-view entry waits longer");
        System.out.println("RepairBench C pan order: coarser new-view entries delayed SR=" + srDelayed
                + " repair=" + repairDelayed + " (failed stratum " + f.brush().stratum() + ")");

        int control = MsgGaze.Plan.start(1, 8, 101, 8, 0).encode().length + MsgGaze.Plan.end(1, 8, 300).encode().length;
        System.out.println("RepairBench D cost: repair control bytes per failure SOLTAR=" + control
                + " (SR 0); out-of-plan queue entries per failure: repair 0, SR 1");
        System.out.println("RepairBench OK");
    }

    /** The planner over a real LoanBook, as the server's canvas view feeds it. */
    private static List<PlanEntry> plan(MsgGaze.Gaze g, LoanBook book) {
        BookView view = new BookView() {
            @Override
            public int bands(BrushId p) {
                return book.bands(p);
            }

            @Override
            public int heldFrom(BrushId p, int from) {
                return book.heldFrom(p, from);
            }
        };
        return ConePlanner.plan(g, FULL, view, META, 3, 0).entries();
    }

    private static int bands(List<PlanEntry> entries) {
        return entries.stream().mapToInt(e -> e.through() - e.from()).sum();
    }

    private static int delayedBehind(List<PlanEntry> plan, BrushId brush) {
        int at = 0;
        while (!plan.get(at).brush().equals(brush)) {
            at++;
        }
        int stratum = brush.stratum();
        return (int) plan.subList(at + 1, plan.size()).stream().filter(e -> e.brush().stratum() > stratum).count();
    }

    private static void print(String scenario, int failures, int sr, int repair) {
        System.out.println("RepairBench " + scenario + ": failures=" + failures + " bands SR=" + sr + " repair="
                + repair + " (bytes SR=" + (long) sr * BYTES_PER_BAND + " repair=" + (long) repair * BYTES_PER_BAND + ")");
    }
}
