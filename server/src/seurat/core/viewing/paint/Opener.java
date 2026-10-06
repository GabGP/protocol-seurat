package seurat.core.viewing.paint;

import java.util.concurrent.Semaphore;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.observe.LogUnits;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.Delivery;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;

/**
 * Spec 4.1.4-5 for one entry, under the canvas lock: (a) concession and edition,
 * (b) monotone parent, (c) book in brushes and RECIBO.libre, (e) slots
 * (check d is gone per ADR-05), then number + book BEFORE any byte.
 */
final class Opener {
    private final Regulator regulator;
    private final Semaphore globalSlots;
    private final InFlightDeliveries inFlight;
    private final DeliveryWriter writer;
    private final PaintQueue queue;

    Opener(Regulator regulator, Semaphore globalSlots,
            InFlightDeliveries inFlight, DeliveryWriter writer, PaintQueue queue) {
        this.regulator = regulator;
        this.globalSlots = globalSlots;
        this.inFlight = inFlight;
        this.writer = writer;
        this.queue = queue;
    }

    /**
     * The session's own gates: (c), its (e) slots, rate and cola_ms. Cheap, leaf locks only
     * (PaintQueue monitor). Waiting on these is flow control, not server queueing (ADR-07 rule 1).
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
            PlanEntry ready = servable(canvas, e);
            if (ready == null) {
                if (e.from() == 0) {
                    canvas.giveUp(e.brush());
                    canvas.plan().lost();
                }
                // No valid band on disk: nothing to send. Band 0 bad: given up and announced (ADR-06).
                PlanEvents.resolved(canvas, x.generation());
                return;
            }
            e = ready;
            if (!eligible(x) || !session.takeSlot()) {
                queue.pushFront(x);
                return;
            }
            if (!globalSlots.tryAcquire()) {
                session.releaseSlot();
                queue.pushFront(x);
                return;
            }
            open(canvas, x, e);
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
        return c.allows(brush) && (brush.stratum() >= SeuratConstants.SEED_STRATUM
                || canvas.book().bands(brush.parentCapped(canvas.meta().strata() - 1)) >= through);
    }

    private void open(Canvas canvas, Pending x, PlanEntry e) {
        Session session = canvas.session();
        Delivery delivery;
        try {
            int bytes = (int) Math.min(Integer.MAX_VALUE, canvas.store().bytes(e.brush(), e.from(), e.through()));
            delivery = canvas.book().log(e.brush(), e.from(), e.through(), bytes, canvas.concession().epoch());
            regulator.meter().opened(e.brush().stratum(), e.through() - e.from(), delivery.bytes());
            canvas.plan().demand().opened(e.pass(), delivery.bytes());
        } catch (Exception ex) {
            Log.warn(LogTags.PAINT, canvas.subject() + " open failed brush=" + e.brush() + ": " + LogUnits.cause(ex));
            session.releaseSlot();
            globalSlots.release();
            PlanEvents.resolved(canvas, x.generation());
            return;
        }
        canvas.plan().numbered(x.generation(), delivery.number());
        session.stride += Math.max(1, delivery.bytes());
        session.rate.spend(delivery.bytes());
        inFlight.add(canvas, delivery);
        var flow = new DeliveryWriter.Flow(canvas, delivery, canvas.store(), x.generation());
        Thread.ofVirtual().start(() -> writer.write(flow));
    }
}
