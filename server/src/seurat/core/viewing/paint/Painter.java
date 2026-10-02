package seurat.core.viewing.paint;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.function.Predicate;
import seurat.core.shared.config.SeuratConstants;
import seurat.core.shared.observe.Metrics;
import seurat.core.shared.proto.Ranges;
import seurat.core.viewing.concession.Concession;
import seurat.core.viewing.loans.Delivery;
import seurat.core.viewing.plan.PlanEntry;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Regulator;
import seurat.core.viewing.session.Session;

/**
 * Sole point through which points leave the server (spec 4.1, 6.2). Checks (a) concession
 * and edition, (b) monotone parent, (c) book in brushes and RECIBO.libre, (e) slots in order;
 * check (d) is gone (ADR-05). Up to 512 virtual writers copy bytes. Number + book BEFORE bytes.
 */
public final class Painter implements Runnable {
    private final PaintQueue queue = new PaintQueue();
    private final Semaphore globalSlots = new Semaphore(SeuratConstants.GLOBAL_SLOTS);
    private final InFlightDeliveries inFlight = new InFlightDeliveries();
    private final Opener opener;

    public Painter(Regulator regulator, Metrics metrics) {
        DeliveryWriter writer = new DeliveryWriter(metrics, globalSlots, inFlight, queue::wake);
        this.opener = new Opener(regulator, globalSlots, inFlight, writer, queue);
    }

    /** Replaces the canvas's pending plan: its unopened entries are dropped (spec 4.1.3). */
    public void enqueue(Canvas canvas, List<PlanEntry> entries, long generation) {
        long now = System.nanoTime();
        List<Pending> list = new ArrayList<>(entries.size());
        for (PlanEntry e : entries) {
            list.add(new Pending(canvas, e, now, canvas.meta().edition(), generation));
        }
        queue.replace(canvas, list);
    }

    /** SOLTAR DECODIFICACION / CRC: the same bands once more, ahead of the plan (spec 5.3). */
    public void resend(Canvas canvas, Delivery d) {
        queue.pushFront(new Pending(canvas, new PlanEntry(d.brush(), d.from(), d.through(), 1),
                System.nanoTime(), canvas.meta().edition(), Pending.RESEND));
    }

    /** CERRAR or session end: its unopened entries must not keep using the link. */
    public void drop(Canvas canvas) {
        queue.drop(canvas);
    }

    /** RECIBO, SOLTAR or cola_ms changed a gate: re-check waiting canvases. */
    public void unpark(Canvas canvas) {
        queue.wake();
    }

    public boolean isIdle() {
        return queue.isEmpty() && inFlight.isEmpty();
    }

    /** Reduction (spec 4.2.2), canvas lock held: queue out, in-flight RESET. Returns the cancelled numbers. */
    public Ranges purge(Canvas canvas, Concession next) {
        Predicate<Pending> forbidden = p -> !next.allows(p.entry().brush(), p.entry().through())
                || p.edition() != canvas.meta().edition();
        for (Pending p : queue.removeIf(canvas, forbidden)) {
            PlanEvents.resolved(canvas, p.generation());
        }
        return inFlight.cancel(canvas, d -> !next.allows(d.brush(), d.through()));
    }

    /** Withdrawal (spec 7.4): nothing more is opened and every flow in flight is cut. */
    public Ranges purgeAll(Canvas canvas) {
        queue.drop(canvas);
        return inFlight.cancel(canvas, d -> true);
    }

    @Override
    public void run() {
        for (;;) {
            try {
                opener.serve(queue.take(opener::eligible, opener::slotFree, SeuratConstants.PAINTER_WAIT_MS));
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }
}
