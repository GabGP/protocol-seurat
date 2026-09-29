package seurat.session;

import java.util.Set;
import seurat.kit.TestKit;
import seurat.proto.Ranges;

/** LoanLeases: only numbers the book holds are recorded, so an invented ACUSE/RECIBO cannot pile up. */
public final class LoanLeasesTest {
    public static void main(String[] args) {
        LoanLeases leases = new LoanLeases();
        Set<Long> held = Set.of(1L, 2L);
        leases.acknowledge(Ranges.of(1, 2, 999), held, 0, 10, 0);
        leases.settle(Ranges.of(2, 999), held);
        TestKit.check(leases.isSettled(2), "held number settles");
        TestKit.check(!leases.isSettled(999), "unheld number is not retained as settled");
        java.util.List<Long> expired = new java.util.ArrayList<>();
        leases.expired(1_000, expired::add);
        TestKit.check(expired.size() == 2 && !expired.contains(999L), "unheld number has no lease deadline");
        LoanBook book = new LoanBook();
        book.log(new seurat.codec.BrushId(1, 0, 0), 0, 2, 100, 1);
        book.acknowledge(Ranges.of(1, 500), 0, 10, 0);
        book.settle(Ranges.of(1, 500));
        java.util.List<Long> late = new java.util.ArrayList<>();
        book.pruneExpired(1_000).forEach(late::add);
        TestKit.check(late.equals(java.util.List.of(1L)), "book prunes only what it held");
        System.out.println("LoanLeasesTest OK");
    }
}
