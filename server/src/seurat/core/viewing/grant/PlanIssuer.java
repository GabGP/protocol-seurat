package seurat.core.viewing.grant;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.plan.BookView;
import seurat.core.viewing.plan.ConePlanner;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;

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
        long first = canvas.book().lastNumber() + 1;
        long generation = canvas.plan().start(seq, entries.size());
        canvas.plan().cutTo(ConePlanner.rung(canvas.session().share));
        GrantController.send(canvas.session(), FrameType.PLAN,
                MsgGaze.Plan.start(canvas.handle(), seq, first, entries.size(), throttle,
                        canvas.takeUnrecoverable().stream().map(BrushId::id).toList()).encode());
        painter.enqueue(canvas, entries, generation);
        if (entries.isEmpty()) {
            GrantController.send(canvas.session(), FrameType.PLAN,
                    MsgGaze.Plan.end(canvas.handle(), seq, first - 1).encode());
        }
    }

    /**
     * Spec 6.3 and 8: the live MIRADA planned again, after load recovered past the rung its plan
     * was cut to or a delivery was cut before its FIN. What is held or on its way is not planned
     * twice, so only what is missing goes out (retouches, new numbers). Canvas lock.
     */
    void replan(Canvas canvas, List<PlanEntry> sketch) {
        MsgGaze.Gaze gaze = canvas.gaze();
        if (gaze == null) {
            issue(canvas, 0, sketch, 0); // no MIRADA yet: the sketch is the plan
            return;
        }
        Session s = canvas.session();
        var planned = ConePlanner.plan(gaze, canvas.concession(), view(canvas), canvas.meta(), s.share, s.queueMs());
        issue(canvas, gaze.seq(), planned.entries(), planned.throttle());
    }

    /** The planner's view of a canvas: unusable brushes count as held, entries stop at held bands (ADR-06). */
    static BookView view(Canvas canvas) {
        return new BookView() {
            @Override
            public int bands(BrushId p) {
                return canvas.plannedBands(p);
            }

            @Override
            public int heldFrom(BrushId p, int from) {
                return canvas.book().heldFrom(p, from);
            }
        };
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
