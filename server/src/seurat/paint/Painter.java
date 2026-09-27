package seurat.paint;

import java.util.List;
import java.util.concurrent.PriorityBlockingQueue;
import java.util.concurrent.Semaphore;
import seurat.budget.BrushBudget;
import seurat.codec.BrushId;
import seurat.config.SeuratConstants;
import seurat.observe.Log;
import seurat.observe.Metrics;
import seurat.plan.PlanEntry;
import seurat.proto.Ranges;
import seurat.regulate.Regulator;
import seurat.session.Canvas;
import seurat.session.Concession;
import seurat.session.Delivery;

/**
 * Sole point through which points leave the server. Chooser thread does no
 * IO; up to 512 virtual workers copy bytes. Number + annotate BEFORE bytes.
 */
public final class Painter implements Runnable {
    private final PriorityBlockingQueue<Pending> queue =
            new PriorityBlockingQueue<>(4096, Pending.ORDER);
    private final Semaphore globalSlots =
            new Semaphore(SeuratConstants.GLOBAL_SLOTS);
    private final Regulator regulator;
    private final DeliveryWriter writer;
    private final BudgetApplier applier;
    private final InFlightDeliveries inFlight = new InFlightDeliveries();
    private final ParkedEntries parked = new ParkedEntries();

    public Painter(Regulator regulator, BrushBudget budget, Metrics metrics) {
        this.regulator = regulator;
        this.writer = new DeliveryWriter(metrics, globalSlots, inFlight,
                () -> queue.addAll(parked.takeAll()));
        this.applier = new BudgetApplier(budget);
    }

    /** Replaces the pending plan of a canvas (unopened entries discarded). */
    public void enqueue(Canvas canvas, List<PlanEntry> entries) {
        drop(canvas);
        long now = System.nanoTime();
        for (PlanEntry entry : entries) {
            queue.add(new Pending(canvas, entry, now, canvas.session().stride));
        }
        Log.debug("paint", "Enqueued " + entries.size() + " plan entries for canvas "
                + canvas.handle() + " (session " + canvas.session().id() + ")");
    }

    /** CERRAR or session end: its unopened entries must not keep using the link. */
    public void drop(Canvas canvas) {
        queue.removeIf(p -> p.canvas() == canvas);
        parked.take(canvas);
    }

    /** RECIBO or SOLTAR freed receiver credit: retry what the canvas parked. */
    public void unpark(Canvas canvas) {
        queue.addAll(parked.take(canvas));
    }

    /** True when no entry is queued, parked, or mid-write. */
    public boolean isIdle() {
        return queue.isEmpty() && parked.isEmpty() && inFlight.isEmpty();
    }

    /** Budget finalize before PLAN START (see BudgetApplier). */
    public BudgetedPlan applyBudget(Canvas canvas, List<PlanEntry> entries) {
        return applier.apply(canvas, entries);
    }

    /**
     * Revocation purge: drops queued entries the concession forbids and
     * cancels violating in-flight deliveries. Returns the cancelled ranges.
     */
    public Ranges purge(Canvas canvas, Concession next) {
        java.util.function.Predicate<Pending> forbidden = p -> p.canvas() == canvas
                && (!next.allows(p.entry().brush(), p.entry().through())
                        || p.edition() != canvas.meta().edition());
        queue.removeIf(forbidden);
        parked.removeIf(canvas, forbidden);
        Ranges cancelled = inFlight.purge(canvas, next);
        if (!cancelled.isEmpty()) {
            Log.debug("paint", "Purged entries for canvas " + canvas.handle()
                    + ", cancelled in-flight=" + cancelled.size());
        }
        return cancelled;
    }

    @Override
    public void run() {
        for (;;) {
            try {
                Pending x = queue.take();
                serve(x);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void serve(Pending pending) {
        Canvas canvas = pending.canvas();
        synchronized (canvas) {
            Concession concession = canvas.concession();
            var book = canvas.book();
            BrushId brush = pending.entry().brush();
            int through = pending.entry().through();
            if (pending.edition() != canvas.meta().edition()
                    || !concession.allows(brush, through)
                    || (brush.stratum() < 10 && book.bands(brush.parentCapped(
                            canvas.meta().strata() - 1)) < through)) {
                return;
            }
            // Receiver window (RECIBO.libre) caps unconfirmed deliveries: on a slow link the
            // backlog ahead of a new MIRADA or a control frame stays near one window.
            if (book.size() >= concession.maxBrushes() || book.unsettled() >= canvas.free
                    || !canvas.session().takeSlot()) {
                parked.park(pending);
                return;
            }
            if (!globalSlots.tryAcquire()) {
                canvas.session().releaseSlot();
                parked.park(pending);
                return;
            }
            regulator.onStart(canvas.session(), System.nanoTime() - pending.queuedNs());
            Delivery delivery;
            try {
                delivery = book.log(brush, pending.entry().from(), through,
                        (int) Math.min(Integer.MAX_VALUE, canvas.store().bytes(brush,
                                pending.entry().from(), through)),
                        concession.epoch());
            } catch (Exception ex) {
                Log.warn("paint", "Delivery book log error on canvas " + canvas.handle()
                        + " brush " + brush.id() + ": " + ex.getMessage());
                canvas.session().releaseSlot();
                globalSlots.release();
                return;
            }
            canvas.session().stride += Math.max(1, delivery.bytes());
            Delivery done = delivery;
            inFlight.add(canvas, done);
            Thread.ofVirtual().start(() -> writer.write(canvas, done));
        }
    }
}
