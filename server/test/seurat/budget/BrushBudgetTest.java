package seurat.budget;

import java.nio.file.Files;
import java.nio.file.Path;
import seurat.catalog.WorkRecord;
import seurat.codec.BrushId;
import seurat.kit.TestKit;
import seurat.store.WorkMeta;

/** Budget (spec 9.2): first serve charges, redelivery free, per-role rules, caps, sketch exempt. */
public final class BrushBudgetTest {
    static WorkMeta meta() {
        return new WorkMeta("w", "w", 1024, 1024, 256, 11, 3, 2, 0, 2);
    }

    public static void main(String[] args) throws Exception {
        Path root = Files.createTempDirectory("budget-test");
        chargeAndFree(root);
        anonymousBucket(root);
        authenticatedCap(root);
        System.out.println("BrushBudgetTest OK");
    }

    private static void chargeAndFree(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("a"));
        BrushId p = new BrushId(0, 0, 0);
        TestKit.check(budget.consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()), "first serve charged");
        TestKit.check(budget.consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()), "redelivery free");
        TestKit.check(budget.consume("u", "w", new BrushId(1, 0, 0), 0, 4, WorkRecord.AUTHENTICATED, meta()),
                "authenticated s1 is not budgeted");
        TestKit.check(new BrushBudget(root.resolve("a"))
                .consume("u", "w", p, 0, 2, WorkRecord.AUTHENTICATED, meta()), "coverage persists");
    }

    /** Anonymous, stratum 1: 1 000 bands then refused (the Painter serves s + 1 instead). */
    private static void anonymousBucket(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("b"));
        var big = new WorkMeta("img/big", "big", 262_144, 262_144, 256, 11, 3, 2, 0, 2);
        int served = 0;
        while (served < 2_000 && budget.consume("anon-x", "img/big",
                new BrushId(1, served % 512, served / 512), 0, 2, WorkRecord.ANONYMOUS, big)) {
            served++;
        }
        TestKit.check(served == 500, "1 000 bands = 500 brushes x 2 bands (nested id), got " + served);
        TestKit.check(budget.consume("anon-x", "img/big", new BrushId(7, 0, 0), 0, 4, WorkRecord.ANONYMOUS, big),
                "the sketch is never budgeted");
    }

    /** Authenticated, stratum 0: at most 15 % of E0 covered, even with bands left in the bucket. */
    private static void authenticatedCap(Path root) throws Exception {
        BrushBudget budget = new BrushBudget(root.resolve("c"));
        var small = new WorkMeta("s", "s", 2560, 2560, 256, 5, 3, 2, 0, 2); // E0 = 10 x 10 brushes
        int served = 0;
        while (served < 100 && budget.consume("bearer-u", "s",
                new BrushId(0, served % 10, served / 10), 0, 1, WorkRecord.AUTHENTICATED, small)) {
            served++;
        }
        TestKit.check(served == 15, "15 % of 100 brushes, got " + served);
    }
}
