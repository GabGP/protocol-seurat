package seurat.concession;

import java.util.List;
import seurat.catalog.Catalog;
import seurat.catalog.WorkRecord;
import seurat.config.SeuratConstants;
import seurat.config.Units;
import seurat.observe.Log;
import seurat.paint.Painter;
import seurat.plan.ConePlanner;
import seurat.plan.ConeTiling;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgAudit;
import seurat.proto.MsgGaze;
import seurat.proto.MsgLoans;
import seurat.proto.ProtoCodes;
import seurat.proto.Ranges;
import seurat.session.Canvas;
import seurat.session.CanvasOrders;
import seurat.session.Concession;
import seurat.session.Session;
import seurat.session.Sessions;

/** Rights path (spec 2.3, 4.2): CONCESION, RASPAR, plans. Every change holds the canvas lock. */
public final class GrantController {
    private final Catalog catalog;
    private final Painter painter;
    final PlanIssuer plans;

    public GrantController(Catalog catalog, Painter painter, Sessions sessions) {
        this.catalog = catalog;
        this.painter = painter;
        this.plans = new PlanIssuer(painter);
    }

    static void send(Session session, long type, byte[] payload) {
        try {
            session.mapping().sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    /** Ceiling of the canvas's role on its work; a withdrawn work grants only the sketch. */
    long[] ceiling(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work == null ? new long[]{SeuratConstants.SKETCH_MIN, 4} : work.ceiling(canvas.session().role());
    }

    boolean lista(Canvas canvas) {
        WorkRecord work = catalog.get(canvas.workId());
        return work != null && work.meta.state() == ProtoCodes.ST_LISTA;
    }

    /** ABRIR follow-up (spec 3.4.1): initial concession (floor: sketch only) + sketch plan. */
    public void open(Session session, Canvas canvas) {
        synchronized (canvas) {
            int[] target = Concessions.target(ceiling(canvas), true, canvas.meta().strata() - 1);
            Concession c = canvas.concession();
            canvas.setConcession(new Concession(c.epoch(), target[0], target[1], c.reason(),
                    c.maxBrushes(), c.maxKiB(), c.leaseS()));
            send(session, FrameType.CONCESION, Concessions.message(canvas).encode());
            plans.issue(canvas, 0, sketch(canvas), 0);
        }
    }

    List<seurat.plan.PlanEntry> sketch(Canvas canvas) {
        return ConeTiling.sketch(canvas.meta(), canvas.concession().minStratum(), canvas::plannedBands);
    }

    /** MIRADA (spec 4.1.1-3): the highest seq wins; lift the floor if LISTA, then replan. */
    public void gaze(Session session, Canvas canvas, MsgGaze.Gaze gaze) {
        synchronized (canvas) {
            if (canvas.retiring || (canvas.gaze() != null && gaze.seq() <= canvas.gaze().seq())) {
                return;
            }
            canvas.setGaze(gaze);
            int top = canvas.meta().strata() - 1;
            if ((gaze.flags() & MsgGaze.M_OCULTA) != 0) {
                canvas.floored = true;
                apply(canvas, Concessions.target(ceiling(canvas), true, top), ProtoCodes.MOT_OCULTA, false);
                return;
            }
            canvas.floored = !lista(canvas); // BOCETO / PINTANDO: the floor stays until LISTA (spec 7.3)
            apply(canvas, Concessions.target(ceiling(canvas), canvas.floored, top), ProtoCodes.MOT_MIRADA, true);
            var planned = ConePlanner.plan(gaze, canvas.concession(), canvas::plannedBands,
                    canvas.meta(), session.share, session.queueMs);
            plans.issue(canvas, gaze.seq(), planned.entries(), planned.throttle());
        }
    }

    /** Moves to target: a reduction scrapes; widening needs demand (a MIRADA, spec 2.3). */
    public void apply(Canvas canvas, int[] target, int motive, boolean widen) {
        synchronized (canvas) {
            Concession cur = canvas.concession();
            if (target[0] == cur.minStratum() && target[1] == cur.maxBands()) {
                return;
            }
            Concession next = Concessions.next(cur, target, motive);
            List<Concessions.Cut> cuts = Concessions.cuts(cur, target, canvas.handle(), next.epoch());
            if (!cuts.isEmpty()) {
                narrow(canvas, next, cuts, null);
            } else if (widen) {
                canvas.setConcession(next);
                send(canvas.session(), FrameType.CONCESION, Concessions.message(canvas).encode());
            }
        }
    }

    /** Barrier-free reduction (spec 4.2.2): epoch+1, N, purge; CONCESION -> CANCELADAS -> RASPAR. */
    public void narrow(Canvas canvas, Concession next, List<Concessions.Cut> cuts, Runnable then) {
        Session session = canvas.session();
        synchronized (canvas) {
            canvas.setConcession(next);
            long n = canvas.book().lastNumber();
            Ranges cancelled = painter.purge(canvas, next);
            send(session, FrameType.CONCESION, Concessions.message(canvas).encode());
            scrape(canvas, n, next.epoch(), cancelled, cuts, then);
            Log.info("concession", canvas.subject() + " concession narrowed motive=" + ProtoCodes.motiveName(next.reason())
                    + " epoch=" + next.epoch() + " minStratum=" + next.minStratum() + " maxBands=" + next.maxBands());
        }
    }

    void scrape(Canvas canvas, long n, long epoch, Ranges cancelled,
            List<Concessions.Cut> cuts, Runnable then) {
        if (!cancelled.isEmpty()) {
            send(canvas.session(), FrameType.PLAN,
                    MsgGaze.Plan.cancelled(canvas.handle(), canvas.plan().seq(), cancelled).encode());
        }
        long deadline = System.nanoTime() + SeuratConstants.SCRAPE_TIMEOUT_S * Units.NANOS_PER_S;
        for (int i = 0; i < cuts.size(); i++) {
            long order = canvas.orders().next();
            MsgLoans.Scrape wire = cuts.get(i).wire().at(order, n);
            send(canvas.session(), FrameType.RASPAR, wire.encode());
            canvas.orders().addScrape(new CanvasOrders.ScrapeOrder(order, n, epoch, cuts.get(i).scrape(),
                    cancelled, deadline, i == cuts.size() - 1 ? then : null, wire));
        }
    }

    public void substitute(Canvas c, WorkRecord work) { new WorkLifecycle(this, painter).substitute(c, work); }
    public void withdraw(Canvas c) { new WorkLifecycle(this, painter).withdraw(c); }
    public void confirm(Canvas c, MsgLoans.Scraped s) { LoanVerifier.confirm(c, s); }
    public void audit(Canvas c, MsgAudit.Inventory i) { LoanVerifier.audit(c, i); }
    public void credit(Canvas c) { painter.unpark(c); }
    public void drop(Canvas c) { painter.drop(c); }
    public void resend(Canvas c, seurat.session.Delivery d) { painter.resend(c, d); }
}
