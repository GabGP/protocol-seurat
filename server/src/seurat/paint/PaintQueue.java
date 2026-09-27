package seurat.paint;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Predicate;
import seurat.session.Canvas;

/**
 * Pending plans, one FIFO per canvas in plan order (passes 1-2-3). The Painter takes
 * among canvas heads by spec 6.2: effective class, then pass, then the session's
 * stride. Only leaf locks (book, atomics) are touched under this monitor.
 */
final class PaintQueue {
    private final Map<Canvas, ArrayDeque<Pending>> byCanvas = new LinkedHashMap<>();

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

    synchronized void pushFront(Pending pending) {
        byCanvas.computeIfAbsent(pending.canvas(), k -> new ArrayDeque<>()).addFirst(pending);
        notifyAll();
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

    /** Blocks until a canvas passes ready and has a head entry; pops the best head. */
    synchronized Pending take(Predicate<Canvas> ready, long recheckMs) throws InterruptedException {
        for (;;) {
            long now = System.nanoTime();
            Pending best = null;
            for (var e : byCanvas.entrySet()) {
                Pending head = e.getValue().peekFirst();
                if (head != null && ready.test(e.getKey()) && better(head, best, now)) {
                    best = head;
                }
            }
            if (best != null) {
                ArrayDeque<Pending> q = byCanvas.get(best.canvas());
                q.pollFirst();
                if (q.isEmpty()) {
                    byCanvas.remove(best.canvas());
                }
                return best;
            }
            if (byCanvas.isEmpty()) {
                wait();
            } else {
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
