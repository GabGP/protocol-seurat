package seurat.core.viewing.session;

import java.util.ArrayDeque;
import java.util.List;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.LoanBook;
import seurat.core.viewing.plan.BookView;
import seurat.core.viewing.plan.ConePlanner;
import seurat.core.viewing.plan.ConePlannerTest;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.works.store.WorkMeta;

/**
 * One viewer of the ADR-07 bench: a gaze that sweeps the spec's slide-0421 (§3.4) row by row, its
 * own LoanBook, and the queue the Painter keeps for it. Plans come from the real ConePlanner.
 */
final class RegulationViewer {
    static final WorkMeta META = new WorkMeta("slide-0421", "s", 196608, 163840, 256, 11, 3, 2, 0, 2);
    static final Concession FULL = new Concession(2, 0, 4, 1, 768, 36864, 120);
    /** Size model, not a measurement: band b of a brush weighs BAND_BYTES[b] (band coefficient counts). */
    static final int[] BAND_BYTES = {2048, 4096, 8192, 16384};
    /** Source pixels of the view: 3840 x 2160 shown on 1920 x 1080 (ideal stratum 1). */
    private static final int VIEW_W = 3840;
    private static final int VIEW_H = 2160;
    /** Each MIRADA moves half a view to the right. */
    private static final int PAN = VIEW_W / 2;

    /** A queued entry; readyNs is when it became its queue's head (spec 6.3 "lista"). */
    record Item(PlanEntry entry, long bytes, Plan plan, long queuedNs, long readyNs) {}

    /** Core (passes 1-2) completion of one plan. */
    static final class Plan {
        final long issuedNs;
        int coreLeft;
        long coreDoneNs = -1;

        Plan(long issuedNs) {
            this.issuedNs = issuedNs;
        }
    }

    final int id;
    final LoanBook book = new LoanBook();
    final ArrayDeque<Item> queue = new ArrayDeque<>();
    final long joinNs;
    final long leaveNs;
    int rung = 3;
    /** The rung the live plan was cut to (PlanProgress.cutTo). */
    int cutRung = 3;
    double stride;
    long seq;
    /** The seq of the live plan's MIRADA; -1 before the first plan. */
    long plannedSeq = -1;
    long x0;
    long y0;
    Plan plan;

    RegulationViewer(int id, long joinNs, long leaveNs) {
        this.id = id;
        this.joinNs = joinNs;
        this.leaveNs = leaveNs;
        ConePlannerTest.sketchBook().forEach((p, bands) -> book.log(p, 0, bands, 1, 1));
        // Viewers start far apart on the work, so their books never overlap in a run.
        x0 = (long) (id * 37 % 40) * 4096;
        y0 = (long) (id * 11 % 60) * 2560;
    }

    boolean active(long nowNs) {
        return nowNs >= joinNs && nowNs < leaveNs;
    }

    MsgGaze.Gaze gaze() {
        return new MsgGaze.Gaze(1, seq, x0, y0, x0 + VIEW_W, y0 + VIEW_H, VIEW_W / 2, VIEW_H / 2, 0);
    }

    /** The next MIRADA: half a view right, wrapping to the next row of views. */
    void pan() {
        seq++;
        x0 += PAN;
        if (x0 + VIEW_W > META.width()) {
            x0 = 0;
            y0 = (y0 + VIEW_H) % (META.height() - VIEW_H);
        }
    }

    List<PlanEntry> cone(int atRung) {
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
        return ConePlanner.plan(gaze(), FULL, view, META, atRung, 0).entries();
    }

    static long bytes(PlanEntry e) {
        long sum = 0;
        for (int b = e.from(); b < e.through(); b++) {
            sum += BAND_BYTES[b];
        }
        return sum;
    }
}
