package seurat.concession;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import seurat.codec.BrushId;
import seurat.paint.Painter;
import seurat.plan.PlanEntry;
import seurat.proto.FrameType;
import seurat.proto.MsgGaze;
import seurat.session.Canvas;

/**
 * PLAN INICIO + hand-off to the Painter (spec 4.1.3). The new plan replaces the
 * pending one; an empty plan is finished at once. Callers hold the canvas lock.
 */
final class PlanIssuer {
    private final Painter painter;

    PlanIssuer(Painter painter) {
        this.painter = painter;
    }

    void issue(Canvas canvas, long seq, List<PlanEntry> entries, int throttle) {
        int flags = throttle | painter.budgetFlags(canvas, entries) | canvas.plan().takeDeferred();
        long first = canvas.book().lastNumber() + 1;
        long generation = canvas.plan().start(seq, entries.size());
        GrantController.send(canvas.session(), FrameType.PLAN,
                MsgGaze.Plan.start(canvas.handle(), seq, first, entries.size(), flags).encode());
        painter.enqueue(canvas, entries, generation);
        if (entries.isEmpty()) {
            GrantController.send(canvas.session(), FrameType.PLAN,
                    MsgGaze.Plan.end(canvas.handle(), seq, first - 1).encode());
        }
    }

    /** Edition swap: the sketch is repainted first, then what the cone adds on top of it. */
    static List<PlanEntry> merge(List<PlanEntry> sketch, List<PlanEntry> cone) {
        List<PlanEntry> out = new ArrayList<>(sketch);
        Set<BrushId> covered = new HashSet<>();
        sketch.forEach(e -> covered.add(e.brush()));
        for (PlanEntry e : cone) {
            if (!covered.contains(e.brush())) {
                out.add(e);
            }
        }
        return out;
    }
}
