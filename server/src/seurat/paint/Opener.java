package seurat.paint;

import java.util.concurrent.Semaphore;
import seurat.budget.BrushBudget;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.plan.PlanEntry;
import seurat.proto.ProtoCodes;
import seurat.session.Regulator;
import seurat.session.Canvas;
import seurat.concession.Concession;
import seurat.session.Delivery;
import seurat.session.Session;

/**
 * Spec 4.1.4-5 for one entry, under the canvas lock: (a) concession and edition,
 * (b) monotone parent, (c) book in brushes and RECIBO.libre, (e) slots, (d) brush budget
 * (failure serves s + 1), then number + book BEFORE any byte.
 */
final class Opener {
    private final Regulator regulator;
    private final BrushBudget budget;
    private final Semaphore globalSlots;
    private final InFlightDeliveries inFlight;
    private final DeliveryWriter writer;
    private final PaintQueue queue;

    Opener(Regulator regulator, BrushBudget budget, Semaphore globalSlots,
            InFlightDeliveries inFlight, DeliveryWriter writer, PaintQueue queue) {
        this.regulator = regulator;
        this.budget = budget;
        this.globalSlots = globalSlots;
        this.inFlight = inFlight;
        this.writer = writer;
        this.queue = queue;
    }

    /**
     * The session's own gates: (c), its (e) slots, rate and cola_ms. Cheap, leaf locks only
     * (PaintQueue monitor). Waiting on these is flow control, not server queueing (spec 6.3).
     */
    boolean eligible(Pending x) {
        Session s = x.canvas().session();
        return s != null && BookGate.open(x.canvas(), x.entry().brush()) && s.canOpen();
    }

    /** (e)'s global half: one of the 512 server-wide slots. */
    boolean slotFree() {
        return globalSlots.availablePermits() > 0;
    }

    void serve(Pending x) {
        Canvas canvas = x.canvas();
        synchronized (canvas) {
            Session session = canvas.session();
            if (session == null || session.canvases().get(canvas.handle()) != canvas) {
                return; // closed or withdrawn meanwhile
            }
            PlanEntry e = x.entry();
            if (x.edition() != canvas.meta().edition() || !permitted(canvas, e.brush(), e.through())) {
                PlanEvents.resolved(canvas, x.generation()); // (a)(b): planned on a stale state
                return;
            }
            e = servable(canvas, e);
            if (e == null) {
                PlanEvents.resolved(canvas, x.generation()); // no valid band on disk: nothing to send, nothing to retry
                return;
            }
            if (!eligible(x) || !session.takeSlot()) {
                queue.pushFront(x.unready());
                return;
            }
            if (!globalSlots.tryAcquire()) {
                session.releaseSlot();
                queue.pushFront(x);
                return;
            }
            PlanEntry chosen = budgeted(canvas, e);
            if (chosen == null) {
                session.releaseSlot();
                globalSlots.release();
                PlanEvents.resolved(canvas, x.generation());
                return;
            }
            open(canvas, x, chosen);
        }
    }

    /** The entry cut to the bands the store still holds intact (spec 8), or null when none of [from,through) is. */
    private static PlanEntry servable(Canvas canvas, PlanEntry e) {
        int through = Math.min(e.through(), canvas.store().validBands(e.brush()));
        if (through <= e.from()) {
            return null;
        }
        return through == e.through() ? e : new PlanEntry(e.brush(), e.from(), through, e.pass());
    }

    private static boolean permitted(Canvas canvas, BrushId brush, int through) {
        Concession c = canvas.concession();
        return c.allows(brush, through) && (brush.stratum() >= SeuratConstants.SEED_STRATUM
                || canvas.book().bands(brush.parentCapped(canvas.meta().strata() - 1)) >= through);
    }

    /** (d) for s <= 1: charge, or substitute the s + 1 version (recorte de entrega, PRESUPUESTO). */
    private PlanEntry budgeted(Canvas canvas, PlanEntry e) {
        Session s = canvas.session();
        int finest = canvas.concession().minStratum();
        if (e.brush().stratum() > 1 || budget.consume(s.principal(), canvas.workId(), e.brush(),
                e.from(), e.through(), s.role(), finest, canvas.meta())) {
            return e;
        }
        canvas.plan().defer(ProtoCodes.REG_PRESUPUESTO);
        BrushId parent = e.brush().parentCapped(canvas.meta().strata() - 1);
        int have = canvas.book().bands(parent);
        if (parent.stratum() >= SeuratConstants.SEED_STRATUM || have >= e.through()
                || (have == 0 && !BookGate.admits(canvas, parent))
                || !permitted(canvas, parent, e.through())
                || !budget.consume(s.principal(), canvas.workId(), parent, have, e.through(),
                        s.role(), finest, canvas.meta())) {
            return null;
        }
        return new PlanEntry(parent, have, e.through(), e.pass());
    }

    private void open(Canvas canvas, Pending x, PlanEntry e) {
        Session session = canvas.session();
        Delivery delivery;
        try {
            int bytes = (int) Math.min(Integer.MAX_VALUE, canvas.store().bytes(e.brush(), e.from(), e.through()));
            regulator.onStart(session, System.nanoTime() - x.readyNs());
            delivery = canvas.book().log(e.brush(), e.from(), e.through(), bytes, canvas.concession().epoch());
        } catch (Exception ex) {
            Log.warn(LogTags.PAINT, canvas.subject() + " open failed brush=" + e.brush() + ": " + LogUnits.cause(ex));
            session.releaseSlot();
            globalSlots.release();
            PlanEvents.resolved(canvas, x.generation());
            return;
        }
        canvas.plan().numbered(x.generation(), delivery.number());
        session.stride += Math.max(1, delivery.bytes()) / SeuratConstants.ROLE_WEIGHT;
        session.rate.spend(delivery.bytes());
        inFlight.add(canvas, delivery);
        var flow = new DeliveryWriter.Flow(canvas, delivery, canvas.store(), x.generation());
        Thread.ofVirtual().start(() -> writer.write(flow));
    }
}
