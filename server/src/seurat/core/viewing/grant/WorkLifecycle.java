package seurat.core.viewing.grant;

import java.util.List;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.shared.proto.msg.MsgGaze;
import seurat.core.shared.proto.msg.MsgLoans;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.concession.Concessions;
import seurat.core.viewing.paint.Painter;
import seurat.core.viewing.plan.ConePlanner;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Session;
import seurat.core.works.catalog.WorkRecord;

/** A work changing under open canvases: edition swap (spec 7.3) and withdrawal (spec 7.4). */
final class WorkLifecycle {
    private final GrantController grants;
    private final Painter painter;

    WorkLifecycle(GrantController grants, Painter painter) {
        this.grants = grants;
        this.painter = painter;
    }

    /** LISTA: new CONCESION, the sketch repainted in ed2 (same ids, new deliveries), the cone on top. */
    void substitute(Canvas canvas, WorkRecord work) {
        synchronized (canvas) {
            if (canvas.retiring) {
                return;
            }
            canvas.setStore(work.store, work.meta);
            boolean seen = canvas.gaze() != null && (canvas.gaze().flags() & MsgGaze.M_OCULTA) == 0;
            canvas.floored = !seen;
            int[] target = Concessions.target(grants.policy.ceiling(canvas), canvas.floored, work.meta.strata() - 1);
            Concession next = Concessions.next(canvas.concession(), target, ProtoCodes.MOT_POLITICA);
            List<Reductions.Cut> cuts = Reductions.cuts(canvas.concession(), target, canvas.handle(), next.epoch());
            if (cuts.isEmpty()) {
                canvas.setConcession(next); // the new plan below replaces every queued ed1 entry
                GrantController.send(canvas.session(), FrameType.CONCESION, Reductions.message(canvas).encode());
            } else {
                grants.narrow(canvas, next, cuts, null);
            }
            var cone = seen ? ConePlanner.plan(canvas.gaze(), next, PlanIssuer.view(canvas), canvas.meta(),
                    canvas.session().rung, canvas.session().queueMs()) : null;
            grants.plans.issue(canvas, seen ? canvas.gaze().seq() : 0,
                    PlanIssuer.merge(grants.sketch(canvas), cone == null ? List.of() : cone.entries()),
                    cone == null ? 0 : cone.throttle());
        }
    }

    /** RASPAR TODO -> RASPADO confirmed -> ERROR 4 (non-fatal); the handle is invalid from then on. */
    void withdraw(Canvas canvas) {
        synchronized (canvas) {
            if (canvas.retiring) {
                return;
            }
            canvas.retiring = true;
            Session session = canvas.session();
            long n = canvas.book().lastNumber();
            Ranges cancelled = painter.purgeAll(canvas);
            long epoch = canvas.concession().epoch();
            grants.scrapes.issue(canvas, n, epoch, cancelled, List.of(new Reductions.Cut(Reductions.all(),
                    MsgLoans.Scrape.all(canvas.handle(), 0, epoch, 0))), () -> retire(session, canvas));
        }
    }

    private void retire(Session session, Canvas canvas) {
        GrantController.send(session, FrameType.ERROR, new MsgError.ProtocolError(
                ProtoCodes.ERR_OBRA_INEXISTENTE, 0, FrameType.RASPADO, "handle " + canvas.handle()).encode());
        session.canvases().remove(canvas.handle(), canvas);
        painter.drop(canvas);
        Log.info(LogTags.CONCESSION, canvas.subject() + " withdrawn");
    }
}
