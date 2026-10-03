package seurat.core.viewing.paint;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Predicate;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.CapacityMeter;
import seurat.core.viewing.session.Session;

/**
 * Pending plans, one FIFO per canvas in plan order (passes 1-2-3). The Painter takes
 * among canvas heads by spec 6.2: effective class, then pass, then the session's
 * stride. Only leaf locks (book, atomics) are touched under this monitor.
 */
final class PaintQueue {
    private final CapacityMeter meter;
    private final Map<Canvas, ArrayDeque<Pending>> byCanvas = new LinkedHashMap<>();

    PaintQueue(CapacityMeter meter) {
        this.meter = meter;
    }

    synchronized void replace(Canvas canvas, List<Pending> entries) {
        if (!byCanvas.containsKey(canvas) && !entries.isEmpty()) {
            // Stride scheduling: a session that becomes active starts at the current pass, not 0.
            double pass = byCanvas.keySet().stream().mapToDouble(c -> c.session().stride).min().orElse(0);
            canvas.session().stride = Math.max(canvas.session().stride, pass);
        }
        if (entries.isEmpty()) {
            byCanvas.remove(canvas);
        } else {
            byCanvas.put(canvas, new ArrayDeque<>(entries));
        }
        notifyAll();
    }

    /** Re-queues a taken entry; a canvas closed meanwhile (CERRAR ran drop) must not get its queue back. */
    synchronized void pushFront(Pending pending) {
        if (!open(pending.canvas())) {
            return;
        }
        byCanvas.computeIfAbsent(pending.canvas(), k -> new ArrayDeque<>()).addFirst(pending);
        notifyAll();
    }

    private static boolean open(Canvas canvas) {
        Session s = canvas.session();
        return s != null && s.canvases().get(canvas.handle()) == canvas;
    }

    synchronized void drop(Canvas canvas) {
        byCanvas.remove(canvas);
    }

    synchronized List<Pending> removeIf(Canvas canvas, Predicate<Pending> drop) {
        List<Pending> out = new ArrayList<>();
        ArrayDeque<Pending> q = byCanvas.get(canvas);
        if (q != null) {
            q.removeIf(p -> drop.test(p) && out.add(p));
            if (q.isEmpty()) {
                byCanvas.remove(canvas);
            }
        }
        return out;
    }

    synchronized boolean isEmpty() {
        return byCanvas.isEmpty();
    }

    synchronized boolean queued(Canvas canvas) {
        return byCanvas.containsKey(canvas);
    }

    /** Something a gate waits on changed (RECIBO, SOLTAR, a finished flow). */
    synchronized void wake() {
        notifyAll();
    }

    /**
     * Blocks until a canvas passes eligible, a global slot is free and it has a head entry, and
     * pops the best head. Every decision tells the meter whether a ready entry is left waiting
     * (ADR-07 rule 1: Painter busy time). Waiting on a session's own gates is not busy.
     */
    synchronized Pending take(Predicate<Pending> eligible, BooleanSupplier slotFree, long recheckMs)
            throws InterruptedException {
        for (;;) {
            long now = System.nanoTime();
            boolean slot = slotFree.getAsBoolean();
            Pending best = null;
            int ready = 0;
            for (var e : byCanvas.entrySet()) {
                ArrayDeque<Pending> q = e.getValue();
                Pending head = q.peekFirst();
                if (head == null || !eligible.test(head)) {
                    continue;
                }
                ready++;
                if (slot && better(head, best, now)) {
                    best = head;
                }
            }
            if (best != null) {
                meter.backlog(ready > 1, now);
                ArrayDeque<Pending> q = byCanvas.get(best.canvas());
                q.pollFirst();
                if (q.isEmpty()) {
                    byCanvas.remove(best.canvas());
                }
                return best;
            }
            if (byCanvas.isEmpty()) {
                meter.backlog(false, now);
                wait();
            } else {
                meter.backlog(ready > 0, now);
                wait(recheckMs);
            }
        }
    }

    private static boolean better(Pending a, Pending b, long now) {
        if (b == null) {
            return true;
        }
        int ca = a.effectiveClass(now);
        int cb = b.effectiveClass(now);
        if (ca != cb) {
            return ca > cb;
        }
        if (a.entry().pass() != b.entry().pass()) {
            return a.entry().pass() < b.entry().pass();
        }
        return a.canvas().session().stride < b.canvas().session().stride;
    }
}
